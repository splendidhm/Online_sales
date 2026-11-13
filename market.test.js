const test=require("node:test"),assert=require("node:assert/strict");
const {evaluate}=require("./market"),{research}=require("./research");
test("자료 부족과 가격 경쟁강도 · 같은 판매자를 한 곳으로 계산",()=>{
  const duplicate=Array.from({length:5},(_,i)=>({...exact,url:exact.url+i}));
  const r=evaluate({...input,demandLevel:"높음"},duplicate,"네이버");
  assert.equal(r.assessment.coverage,30);
  assert.equal(r.assessment.total,null);
  assert.equal(r.assessment.strength,"미확인");
  assert.equal(r.assessment.factors.find(f=>f.key==="demand").score,null);
});
test("근거 충족률 100% · 가격 및 이익률과 독립적으로 가중 점수 산출",()=>{
  const offers=[8000,10000,12000].map((price,i)=>({...exact,price,seller:"판매자"+i,url:exact.url+i}));
  const reviewed={...input,demandLevel:"높음",demandEvidence:"연습 주문 추세",supplierLevel:"보통",supplierEvidence:"연습 출고 이력",differenceLevel:"낮음",differenceEvidence:"표본과 동일한 구성"};
  const r=evaluate(reviewed,offers,"네이버");
  assert.equal(r.reference,10000);
  assert.equal(r.margin,5);
  assert.equal(r.assessment.coverage,100);
  assert.equal(r.assessment.total,51);
  assert.equal(r.assessment.strength,"보통");
});
const input={maker:"A",model:"B",option:"중형 1개",keywords:"정리함 중형",grade:"일반",category:"수납/정리용품",cost:8837,shipping:0,freight:0};
const exact={title:"정리함",maker:"A",model:"B",option:input.option,reviews:0,price:10000,shipping:0,time:"2026-11-11T12:00",url:"https://example.com/x",seller:"판매자",match:true};
const similar=Array.from({length:10},(_,i)=>({...exact,model:"C",price:20000+i*1000,reviews:i,url:"https://example.com/"+i}));
test("동일품 우선 · 시장가에서 5% 역산",()=>{
 const r=evaluate(input,[exact,...similar],"네이버");assert.equal(r.reference,10000);assert.equal(r.margin,5);assert.equal(r.similar,5);
});
test("유사품 리뷰 상위 5/10, 공급 배송 조건과 수수료 분리",()=>{
 assert.equal(evaluate(input,similar,"네이버").median,27000);
 assert.equal(evaluate({...input,top:10},similar,"네이버").median,24500);
 assert.equal(evaluate({...input,freight:3000,freeAbove:8000},[exact],"쿠팡").policy.fee,1188);
 assert.equal(evaluate({...input,freight:3000,freeAbove:8000},[exact],"쿠팡").appliedFreight,0);
 assert.equal(evaluate(input,[],"네이버").profit,null);
});
test("검색 어댑터가 동일품과 유사품 검색을 별도로 요청",async()=>{
 const queries=[];const result=await research({input,channel:"네이버"},"https://example.com/search",async url=>{
 queries.push(url.searchParams.get("kind"));return {ok:true,json:async()=>({channel:"네이버",items:[exact]})};
 });assert.deepEqual(queries,["exact","similar"]);assert.equal(result.length,2);
});

test("G마켓 문구 일반 판매가와 선결제 배송비 수수료를 분리하고 미지원 분류는 보류한다",()=>{
  const input={gmarketCategory:"문구/사무용품",maker:"회사",model:"모델",option:"1개",cost:5000,freight:2000,shipping:3000};
  const samples=[{...input,match:true,title:"문구",seller:"판매자",price:10000,url:"https://example.com/gm"}];
  assert.equal(evaluate(input,samples,"G마켓").policy.fee,1399);
  const rounded=evaluate({...input,floor:10001},samples,"G마켓");
  assert.equal(rounded.reference,10010);
  assert.equal(rounded.profit,rounded.reference+3000-5000-2000-rounded.policy.fee);
  assert.equal(evaluate({...input,gmarketCategory:""} ,samples,"G마켓").profit,null);
});
