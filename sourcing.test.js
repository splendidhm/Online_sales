const test=require("node:test");
const assert=require("node:assert/strict");
const {screen,mockProducts}=require("./sourcing");

test("수집 경계와 후보가 모두 부적격인 회차",()=>{
  for(const limit of [0,-1,1.5,1001,null])assert.throws(()=>mockProducts(limit));
  assert.equal(mockProducts(1).length,1);
  const items=mockProducts(20).map(row=>({...row,stock:0}));
  assert.equal(screen(items).counts["조사 대상"],0);
});
test("옵션별 중복 판정과 1,000건 집계",()=>{
  const [product]=mockProducts(1);
  const result=screen([product,{...product,option:"대형 2개"},product]);
  assert.equal(result.counts["조사 대상"],2);
  assert.equal(result.counts["중복"],1);
  const all=screen(mockProducts(1000));
  assert.equal(Object.values(all.counts).reduce((sum,n)=>sum+n),1000);
  assert.equal(all.counts["조사 대상"],10);
});
