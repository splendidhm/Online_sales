const {test} = require("node:test");
const assert = require("node:assert/strict");
const {evaluate} = require("./calculator");
const base = {price:14900,shipping:0,discount:0,cost:6000,freight:3000,packing:0,ads:600,returns:300,fee:10,target:20,floor:0};
const samples = [12000,13000,14900,15000,16000].map((price,i)=>({price,shipping:0,seller:String(i),url:"https://example.com/"+i,time:"2026-11-11T09:00",match:true}));
test("기준 주문과 공급가 상승",()=>{
  assert.equal(evaluate(base,[]).profit,3510);
  assert.equal(evaluate({...base,cost:6600},[]).profit,2910);
  assert.equal(evaluate(base,[]).margin.toFixed(1),"23.6");
});
test("5개 표본 중앙값과 중복·조건 제외",()=>{
  assert.equal(evaluate(base,samples).reference,14900);
  const four=samples.slice(0,4);
  assert.equal(evaluate(base,[...four,four[0],{...samples[4],match:false}]).reference,null);
  assert.equal(evaluate({...base,floor:17000},samples).viable,false);
});
test("배송비·할인 포함, 비용 누락과 0원 구분",()=>{
  assert.equal(evaluate({...base,shipping:3000,discount:1000},[]).profit,5310);
  assert.throws(()=>evaluate({...base,ads:""},[]));
  assert.equal(evaluate({...base,ads:0},[]).profit,4110);
});
