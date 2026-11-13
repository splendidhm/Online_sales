const test=require("node:test");
const assert=require("node:assert/strict");
const {catalogRow,fetchCatalog,supplierImage}=require("./supplier-provider");
const {naverProvider}=require("./naver-provider");
const {coupangProvider}=require("./coupang-provider");
const sample={no:"381",title:"정리함",channel:{supply:true},selectOpt:"",price:{supply:"1+4500|10+4000",resale:{minimum:6000}},qty:{supplyUnit:1,inventory:20},deli:{supply:{type:"고정",defaultFee:3000}},desc:{license:{usable:true,msg:"네이버 사용 허가"}},thumb:{original:"https://images.example/a.jpg"}};

test("도매매 공급 회차는 커서를 이어받고 옵션가·배송 조건 미확인은 보완으로 분리한다",async()=>{
  let count=0;
  const snapshot=await fetchCatalog({keyword:"정리함",limit:2},async(url,init)=>{
    assert.equal(init.headers.Authorization,"Bearer sample");const body=JSON.parse(init.body);
    if(++count===1)return Response.json({result:true,data:{searchAfter:[381],list:[sample]}});
    assert.deepEqual(body.search_after,[381]);
    return Response.json({result:true,data:{list:[{...sample,no:"382",selectOpt:"{}",deli:{}}]}});
  },"sample");
  assert.equal(snapshot.counts["조사 대상"],1);assert.equal(snapshot.counts["보완"],1);
  assert.equal(snapshot.rows[0].cost,4500);assert.equal(snapshot.rows[0].floor,6000);
  assert.equal(catalogRow({...sample,selectOpt:'{"options":[1]}'},"").cost,null);
  const evidence=snapshot.rows[0].evidence;
  await assert.rejects(supplierImage(evidence,()=>assert.fail(),"https://another.example"));
  assert.match(await supplierImage(evidence,async()=>new Response(Buffer.from("ffd8ff00","hex")),"https://images.example"),/^data:image\/jpeg;base64,/);
});
test("네이버 주문·정산 가져오기에서 구매자 정보는 제거하고 페이지별 행을 보존한다",async()=>{
  const responses=[{data:{lastChangeStatuses:[{productOrderId:"12"}]}},{data:[{productOrder:{productOrderId:"12",productName:"상품",totalPaymentAmount:2000,quantity:1,shippingAddress:"PRIVATE"},order:{orderId:"1",ordererName:"PRIVATE"}}]},
    {elements:[{productOrderId:"12",orderId:"1",settleExpectAmount:1800,purchaserName:"PRIVATE"}],pagination:{totalPages:2}},
    {elements:[{productOrderId:"13",orderId:"1",settleExpectAmount:-500}],pagination:{totalPages:2}}];
  const p=naverProvider(async()=>Response.json(responses.shift()),"test");
  const orders=await p.records("2026-11-11","orders");
  assert.equal(orders[0].ref,"12");assert.ok(!JSON.stringify(orders).includes("PRIVATE"));
  const settlements=await p.records("2026-11-11","settlements");assert.deepEqual(settlements.map(r=>r.amount),[1800,-500]);
});
test("쿠팡 원장 조회는 긴 주문번호와 배송비 단독 정산을 보존한다",async()=>{
  const p=coupangProvider(async()=>new Response('{"code":200,"data":[{"orderId":123456789012345678,"saleType":"REFUND","items":[],"deliveryFee":{"settlementAmount":3000}}]}'),{ACC_COUPANG_VENDOR:"vendor",ACC_COUPANG_KEY:"key",ACC_COUPANG_SECRET:"test"});
  const rows=await p.records("2026-11-11","settlements");assert.equal(rows[0].ref,"123456789012345678");assert.equal(rows[0].type,"delivery");
});
