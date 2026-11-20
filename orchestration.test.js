"use strict";

const {test} = require("node:test");
const assert = require("node:assert/strict");
const {DatabaseSync} = require("node:sqlite");
const {mkdtempSync, rmSync} = require("node:fs");
const {tmpdir} = require("node:os");
const {join} = require("node:path");
const {Workbook} = require("exceljs");
const {createApp} = require("./server");
const {orchestration} = require("./orchestration");
const {mockProducts, screen} = require("./sourcing");

test("분석 실행은 중복을 방지하고 재시작 뒤 저장한 조사 단계부터 이어간다", async t => {
  const directory = mkdtempSync(join(tmpdir(), "conu-orchestration-"));
  t.after(() => rmSync(directory,{recursive:true,force:true}));
  const filename = join(directory, "test.sqlite");
  let db = new DatabaseSync(filename);
  db.exec("CREATE TABLE sourcing_batches(id INTEGER PRIMARY KEY, mode TEXT, snapshot TEXT)");
  db.exec("CREATE TABLE versions(id INTEGER PRIMARY KEY, channel TEXT, mode TEXT, body TEXT)");
  require("./operations").operations(db);
  db.prepare("INSERT INTO sourcing_batches VALUES(1,'fixture',?)").run(JSON.stringify(screen(mockProducts(1000))));
  let worker = orchestration(db, {schedule:false, ai:async () => assert.fail("연습 자료는 AI를 호출하지 않습니다.")});
  const args = {mode:"fixture",batchId:1,channels:["쿠팡","네이버"]};
  const {id} = worker.start(args);
  assert.equal(worker.start({...args,channels:["네이버","쿠팡"]}).id,id);
  assert.equal(worker.detail(id,"fixture").candidates.length,20);
  await worker.tick();
  assert.equal(worker.detail(id,"fixture").candidates[0].status,"VALIDATING");
  worker.close(); db.close();
  db = new DatabaseSync(filename);
  worker = orchestration(db,{schedule:false});
  try {
    while (await worker.tick()) { /* 저장된 단계부터 처리한다. */ }
    const run = worker.detail(id,"fixture");
    assert.equal(run.status,"COMPLETED");
    assert.equal(run.ranking.length,20);
    assert.equal(run.events.filter(e => e.candidateId === 1 && e.role === "research" && e.status === "RUNNING").length,1);
    assert.throws(() => worker.detail(id,"manual"),{status:404});
  } finally { worker.close(); db.close(); }
});

test("실자료 독립 재조회가 불일치하면 3회 재작업 뒤 보완으로 남긴다", async t => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec("CREATE TABLE sourcing_batches(id INTEGER PRIMARY KEY, mode TEXT, snapshot TEXT)");
  db.exec("CREATE TABLE versions(id INTEGER PRIMARY KEY, channel TEXT, mode TEXT, body TEXT)");
  require("./operations").operations(db);
  const product={...mockProducts(1)[0],name:"서랍 정리함",source:"https://supplier.example/item",keywords:"서랍 정리함"};
  db.prepare("INSERT INTO sourcing_batches VALUES(1,'manual',?)").run(JSON.stringify(screen([product])));
  const sample={title:"서랍 정리함",option:product.option,seller:"판매처",url:"https://market.example/item",
    time:"2026-11-20T09:00",price:12000,shipping:0,reviews:30,match:true};
  let checks=0;
  const worker=orchestration(db,{schedule:false,ai:null,dependencies:{research:async()=>[sample],reobserve:async()=>{checks++;return [];}}});
  const {id}=worker.start({mode:"manual",batchId:1,channels:["네이버"],settings:{네이버:{grade:"일반"}}});
  while(await worker.tick()) { /* 첫 공급 근거 확인까지 진행한다. */ }
  const initial=worker.detail(id,"manual");
  assert.equal(initial.status,"BLOCKED");
  worker.supplement(id,{mode:"manual",candidateId:initial.candidates[0].id,evidence:{source:product.source,time:sample.time,
    origin:"대한민국",disclosure:"플라스틱 정리함",certification:"해당 없음 — 성인용 비전기 수납품",rights:"스마트스토어 원본 상세 이미지 사용 허가",verified:true}});
  while(await worker.tick()) { /* 조사 재작업 한도를 검증한다. */ }
  const run=worker.detail(id,"manual");
  assert.equal(run.status,"BLOCKED");
  assert.equal(checks,4);
  assert.equal(run.candidates[0].revisions,3);
  assert.equal(run.events.filter(e=>e.status==="REVISION_REQUIRED" && e.detail?.length).length,3);
  assert.equal(run.ranking.length,0);
});

test("관리자만 회차와 엑셀을 열 수 있고 분석에서 두 승인 단계로 이어진다", async t => {
  const server = createApp(":memory:","test-key",{orchestrationEnabled:true});
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const root = "http://127.0.0.1:" + server.address().port;
  const request = (route,data) => fetch(root+route,{method:data ? "POST":"GET",
    headers:{Authorization:"Bearer test-key"},body:data ? JSON.stringify(data):undefined});
  const runs = "/api/orchestration/runs";
  assert.equal((await fetch(root+runs+"?mode=fixture")).status,403);
  const batch = await (await request("/api/batches",{limit:1})).json();
  const {id} = await (await request(runs,{mode:"fixture",batchId:batch.id,channels:["네이버"]})).json();
  const run = await (await request(`${runs}/${id}?mode=fixture`)).json();
  assert.equal(run.status,"COMPLETED");
  const [candidate] = run.ranking;
  assert.equal(candidate.validation.status,"PASS");
  const response = await request(`${runs}/${id}/excel?mode=fixture`);
  assert.match(response.headers.get("content-type"),/spreadsheetml/);
  const book = new Workbook();
  await book.xlsx.load(await response.arrayBuffer());
  assert.equal(book.worksheets.length,8);
  const payload = {mode:"fixture",channel:candidate.channel,input:candidate.input,samples:candidate.validation.accepted,
    checks:false,base:0,batchId:batch.id,orchestrationCandidateId:candidate.id};
  const first=await (await request("/api/candidates",payload)).json();
  assert.ok(first.id,first.error);
  assert.equal((await request("/api/decision",{id:first.id,choice:"진행"})).status,400);
  const second=await (await request("/api/candidates",{...payload,base:first.id,checks:true})).json();
  assert.equal((await request("/api/decision",{id:second.id,choice:"진행"})).status,200);
  const draft=await (await request("/api/studio",{version:second.id,action:"open"})).json();
  assert.equal(draft.approved,false);
  assert.equal((await request("/api/market-submit",{version:second.id,revision:draft.id})).status,400);
});
