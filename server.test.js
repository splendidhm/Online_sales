const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {createApp}=require("./server");

test("후보 저장, 마켓 분리, 결정 검증, 동시 수정과 재시작 복구",async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"acc-test-"));
  let server,url;
  async function start(){
    server=createApp(path.join(dir,"test.sqlite"),"test-key");
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    url="http://127.0.0.1:"+server.address().port;
  }
  const stop=()=>new Promise(resolve=>server.close(resolve));
  await start();t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true});});
  const request=(route,data)=>fetch(url+"/api/"+route,{method:data?"POST":"GET",headers:{Authorization:"Bearer test-key"},body:data?JSON.stringify(data):undefined});
  const input={name:"정리함",option:"1개",source:"https://example.com/product",maker:"제조사",model:"A1",grade:"일반",category:"수납/정리용품",shipping:0,discount:0,cost:6000,freight:3000,packing:0,ads:600,returns:300,fee:10,target:20,floor:0};
  const sheet={input,mode:"manual",channel:"네이버",samples:[],checks:true,base:0};
  assert.equal((await fetch(url+"/api/candidates?mode=manual")).status,403);
  assert.match(await (await fetch(url)).text(),/후보 비교와 1차 결정/);
  assert.equal((await request("batches",{limit:1001})).status,400);
  const batch=await (await request("batches",{limit:1000})).json();
  assert.deepEqual(batch.counts,{"조사 대상":10,"순번 대기":490,"중복":100,"제외":300,"보완":100});
  const save=async value=>{
    const response=await request("candidates",value);
    assert.equal(response.status,200);return (await response.json()).id;
  };
  const first=await save(sheet);
  assert.equal((await request("studio",{version:first,action:"open"})).status,400);
  assert.equal((await request("decision",{id:first,choice:"진행"})).status,400);
  sheet.samples=Array.from({length:5},(_,i)=>({seller:String(i),title:"정리함",maker:"제조사",model:"A1",reviews:0,option:"1개",price:14900,shipping:0,url:"https://example.com/"+i,time:"2026-11-11T08:00",match:true}));
  sheet.base=first;
  sheet.input.cost=10167; // 14,900원 − 수수료 988원 − 배송비 3,000원 − 매입가 10,167원 = 745원(5%)
  const second=await save(sheet);
  const evaluated=await (await request("candidates?mode=manual")).json();
  assert.equal(evaluated[0].result.margin,5);
  assert.equal((await request("decision",{id:first,choice:"진행"})).status,409);
  for(let i=0;i<2;i++)assert.equal((await request("decision",{id:second,choice:"진행"})).status,200);
  const studio=(action,base,draft)=>request("studio",{version:second,action,base,draft});
  const initial=await (await studio("open")).json();
  assert.equal(initial.price,14900);
  const draft={...initial.draft,origin:"시험 원산지",disclosure:"시험 고시",returns:"시험 반품 안내",rights:"공급사 사진 사용 동의 문서 1호",imageReviewed:true,
    image:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII="};
  const flagged=await (await studio("save",0,{...draft,imageText:"항균"})).json();
  assert.ok(flagged.issues.some(issue=>issue.field==="imageText"));
  assert.equal((await studio("approve",flagged.id)).status,400);
  const revised=await (await studio("save",flagged.id,draft)).json();
  assert.deepEqual(revised.issues,[]);
  assert.equal((await studio("approve",flagged.id)).status,400);
  assert.equal((await studio("export",revised.id)).status,400);
  assert.equal((await (await studio("approve",revised.id)).json()).approved,true);
  assert.deepEqual((await (await studio("export",revised.id)).json()).draft,draft);
  assert.equal((await request("decision",{id:second,choice:"제외"})).status,409);
  await save({...sheet,base:0,channel:"쿠팡"});
  await stop();await start();
  assert.equal((await (await studio("open")).json()).approved,true);
  assert.equal((await (await request("batches")).json())[0].total,1000);
  assert.deepEqual((await (await request("batches?id="+batch.id)).json()).rows,batch.rows);
  const rows=await (await request("candidates?mode=manual")).json();
  assert.equal(rows.length,2);assert.equal(rows.find(r=>r.id===second).choice,"진행");
  assert.equal(rows.find(r=>r.channel==="쿠팡").choice,null);
  assert.deepEqual(await (await request("candidates?mode=fixture")).json(),[]);
  const selected=batch.rows.find(row=>row.status==="조사 대상");
  const imported={...sheet,base:0,mode:"fixture",batchId:batch.id,input:{...input,...selected}};
  await save(imported);
  assert.equal((await (await request("candidates?mode=fixture")).json())[0].batchId,batch.id);
  assert.equal((await request("candidates",{...imported,mode:"manual"})).status,400);
  const updated={...sheet,input:{...input,cost:6600}};
  assert.equal((await request("candidates",updated)).status,409);
  const third=await save({...updated,base:second});
  assert.equal((await studio("export",revised.id)).status,400);
  const next=await (await request("candidates?mode=manual")).json();
  assert.equal(next.find(r=>r.id===third).choice,null);
});
