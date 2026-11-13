const {test}=require("node:test");
const assert=require("node:assert/strict");
const {naverProvider}=require("./naver-provider");
const {coupangProvider}=require("./coupang-provider");
const {gmarketProvider}=require("./gmarket-provider");
const page={version:7,price:11900,shipping:0,option:"1개",draft:{title:"정리함 1개",image:"data:image/jpeg;base64,YWJj",stock:"4"}};
test("G마켓 단일 상품 등록과 가격 재조회 · 두 등록번호와 노출 대기 구분",async()=>{
  const profile={imageUrl:"https://example.com/item.jpg",itemBasicInfo:{category:{site:[{siteType:2,catCode:"123"}]}},
    itemAddtionalInfo:{officialNotice:{officialNoticeNo:1,details:[{value:"모의 고시"}]},isVatFree:false,sellingPeriod:{gmkt:30},shipping:{companyNo:1,policy:{placeNo:2},dispatchPolicyNo:{gmkt:3}}}};
  const sample={...page,draft:{...page.draft,marketProfile:JSON.stringify(profile)}};
  const env={ACC_ESM_MASTER_ID:"test-master",ACC_ESM_SELLER_ID:"test-seller",ACC_ESM_ISSUER:"example.com",ACC_ESM_SECRET:"test",ACC_ESM_IMAGE_ORIGIN:"https://example.com"};
  let submitted,hidden=false;
  const provider=gmarketProvider(async(url,init)=>{
    if(String(url)===profile.imageUrl)return new Response("abc");
    const jwt=init.headers.Authorization.split(" ")[1].split(".");
    assert.equal(JSON.parse(Buffer.from(jwt[1],"base64url")).ssi,"G:test-seller");
    if(init.method==="POST"){
      submitted=JSON.parse(init.body);
      return Response.json({goodsNo:101,resultCode:0,siteDetail:{gmkt:{SiteGoodsNo:"202",SiteGoodsComment:"Success"}}});
    }
    if(url.endsWith("/sell-status"))return Response.json({IsSell:{gmkt:true},itemBasicInfo:{Price:{gmkt:12000},Stock:{gmkt:4}}});
    assert.ok(url.endsWith("/101"));return Response.json({...submitted,isDisplayExclude:hidden});
  },env);
  const image=await provider.upload(sample);
  const receipt=await provider.submit(sample,sample.draft.marketProfile,image);
  assert.deepEqual(receipt,{external:"101",siteExternal:"202"});
  assert.equal(submitted.itemAddtionalInfo.price.gmkt,11900);
  assert.equal((await provider.read(receipt.external,sample)).price,12000);
  hidden=true;
  assert.deepEqual(await provider.read(receipt.external,sample),{sale:"pending"});
  await assert.rejects(provider.upload({...sample,price:11901}),/10원 단위/);
});
test("스마트스토어 이미지 업로드와 원상품 접수, 전시·판매가 재조회",async()=>{
  const calls=[];
  const data=[{images:[{url:"https://example.com/item.jpg"}]},{originProductNo:123},{originProduct:{name:page.draft.title,statusType:"SALE",detailAttribute:{sellerCodeInfo:{sellerManagementCode:"ACC-7"}},deliveryInfo:{deliveryFee:{deliveryFeeType:"FREE"}},stockQuantity:4,salePrice:12000},smartstoreChannelProduct:{channelProductDisplayStatusType:"ON"}}];
  const p=naverProvider(async(url,init)=>{calls.push({url,init});return Response.json(data.shift());},"test");
  const image=await p.upload(page);
  const profile={leafCategoryId:"10",deliveryInfo:{deliveryFee:{}},detailAttribute:{productInfoProvidedNotice:{}}};
  const id=await p.submit(page,JSON.stringify(profile),image);
  const actual=await p.read(id,page);
  assert.equal(actual.price,12000);assert.equal(actual.stock,4);
  assert.equal(JSON.parse(calls[1].init.body).originProduct.salePrice,11900);
  assert.ok(calls[2].url.endsWith("origin-products/123"));
});
test("쿠팡 상품 이미지 일치 확인과 업체상품 접수, 옵션별 재고 대조",async()=>{
  const profile={product:{displayCategoryCode:1},item:{attributes:[],notices:[]},imageUrl:"https://example.com/i.jpg"};
  const itemPage={...page,draft:{...page.draft,marketProfile:JSON.stringify(profile)}};
  const calls=[];
  const values=[123,{vendorId:"vendor",items:[{itemName:"1개",externalVendorSku:"ACC-7",vendorItemId:321}],statusName:"승인완료",deliveryChargeType:"FREE"},{salePrice:11800,onSale:true,amountInStock:3}];
  const p=coupangProvider(async(url,init)=>{
    if(String(url)===profile.imageUrl)return new Response("abc");
    calls.push({url,init});return Response.json({code:"SUCCESS",data:values.shift()});
  },{ACC_COUPANG_KEY:"key",ACC_COUPANG_SECRET:"test",ACC_COUPANG_VENDOR:"vendor",ACC_COUPANG_IMAGE_ORIGIN:"https://example.com"});
  const image=await p.upload(itemPage);
  const id=await p.submit(itemPage,itemPage.draft.marketProfile,image);
  const observed=await p.read(id,itemPage);
  assert.equal(observed.price,11800);assert.equal(observed.stock,3);
  assert.equal(JSON.parse(calls[0].init.body).items[0].salePrice,11900);
  assert.ok(calls[2].url.endsWith("321/inventories"));
});
test("실등록 거절은 실패로 분류하고 응답 불명은 같은 상품을 재전송하지 않도록 구분한다",async()=>{
  const profile={leafCategoryId:"1",deliveryInfo:{deliveryFee:{}},detailAttribute:{productInfoProvidedNotice:{}}};
  for(const status of [400,503]){
    const p=naverProvider(async()=>new Response("",{status}),"test");
    await assert.rejects(p.submit(page,JSON.stringify(profile),"https://example.com/p.jpg"),error=>error.rejected===(status===400));
  }
});
