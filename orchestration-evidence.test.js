"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { investigate, validateEvidence } = require("./orchestration-evidence");

const time = "2026-11-20T09:00";
const fixture = {code:"M1", name:"서랍 정리함", option:"중형 1개", source:"https://fixture.invalid/product/M1",
  cost:4500, freight:3000, stock:10, minimum:1, direct:true, rights:true, resale:true};
const candidate = {...fixture, source:"https://supplier.example/p/1", maker:"코뉴", model:"T3"};
const input = {...candidate, keywords:"서랍 정리함"};
const supplyConfirmation = {verified:true, source:candidate.source, time, origin:"대한민국", disclosure:"합성수지 및 제조자 확인",
  certification:"성인용 비전기 수납용품 기준 적용 여부 확인", rights:"상품 페이지 사용 허용 문구와 판매 채널 확인"};
function offer(id, changes = {}) {
  return {title:input.name, maker:input.maker, model:input.model, option:input.option, quantity:1,
    seller:"판매처 "+id, url:"https://market.example/p/"+id, time, price:10000, shipping:2000,
    match:true, confirmed:true, reviews:20, ...changes};
}

test("동일·다른 구성·유사·참고 표본과 조건부 가격을 구분한다", async () => {
  const args = {candidate,input,mode:"manual",channel:"네이버", supplyConfirmation};
  const investigation = await investigate({...args, manualSamples:[
    offer("a"), offer("b",{option:"중형 2개",quantity:2}), offer("c",{maker:"다른 제조사"}),
    offer("d",{title:"다른 제품",maker:"다른 제조사"}),
    offer("promo",{price:5000,promoPrice:5000,condition:"회원 전용"}),
    offer("invalid",{shipping:null}),
    offer("unknown",{confirmed:false})
  ]});
  const result = await validateEvidence({...args,investigation});
  assert.equal(result.status,"PASS");
  assert.deepEqual(result.samples.map(x=>x.grade),["A","B","C","D","A","A","A"]);
  assert.deepEqual(result.accepted.map(x=>x.seller),["판매처 a","판매처 c"]);
  assert.equal(result.accepted[0].total,12000);
  assert.equal(result.samples[6].verification,"UNVERIFIED");
});

test("실자료에는 원본을 대조한 기록이 필요하고 공급 영향값 변경은 재작업에 보낸다", async () => {
  const args = {candidate,input,mode:"manual",channel:"네이버"};
  const investigation = await investigate({...args,manualSamples:[offer("a")]});
  assert.equal((await validateEvidence({...args,investigation})).status,"UNVERIFIED");
  assert.equal((await validateEvidence({...args,investigation,
    supplyConfirmation:{...supplyConfirmation,source:"https://other.example/p"}})).status,"UNVERIFIED");
  const conflict = await validateEvidence({...args,input:{...input,cost:4300},investigation,supplyConfirmation});
  assert.equal(conflict.status,"REVISE");
  assert.equal(conflict.issues[0].field,"cost");
  assert.equal((await validateEvidence({...args,candidate:{...candidate,stock:0},investigation,supplyConfirmation})).status,"FAIL");
});

test("검색 결과를 원본 조건으로 재조회하고 모의 자료는 네트워크 없이 생성한다", async () => {
  const args = {candidate,input,mode:"manual",channel:"네이버",supplyConfirmation};
  const investigation = await investigate(args,{research:async()=>[offer("a")]});
  assert.equal(investigation.samples[0].confirmed,false);
  const revised = await validateEvidence({...args,investigation},{reobserve:async()=>[offer("a",{price:11000})]});
  assert.equal(revised.status,"REVISE");
  const verified = await validateEvidence({...args,investigation},{reobserve:async()=>[offer("a")]});
  assert.equal(verified.status,"PASS");
  const mock = {candidate:fixture,input:{...fixture,keywords:"서랍 정리함"},mode:"fixture",channel:"쿠팡"};
  const mockInvestigation = await investigate(mock,{research:()=>assert.fail("모의 조사에 외부 호출이 발생했습니다.")});
  const result = await validateEvidence({...mock,investigation:mockInvestigation});
  assert.equal(result.status,"PASS");
  assert.equal(result.accepted.length,5);
  assert.ok(result.accepted.every(x=>x.grade==="C"));
});
