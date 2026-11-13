"use strict";
const {createHmac}=require("node:crypto");
const {detailMarkup}=require("./detail-editor");
const {verifiedImage}=require("./verified-image");
function coupangProvider(request=fetch,env=process.env){
  const root="/v2/providers/seller_api/apis/api/v1/marketplace/";
  async function call(method,path,body,query){
    if(!env.ACC_COUPANG_KEY||!env.ACC_COUPANG_SECRET||!env.ACC_COUPANG_VENDOR)throw Error("쿠팡 서버 인증 설정을 확인하세요.");
    const date=new Date().toISOString().slice(2,19).replace(/[-:]/g,"")+"Z";
    const params=query?new URLSearchParams(query).toString():"";
    const signature=createHmac("sha256",env.ACC_COUPANG_SECRET).update(date+method+path+params).digest("hex");
    const headers={Authorization:"CEA algorithm=HmacSHA256, access-key="+env.ACC_COUPANG_KEY+", signed-date="+date+", signature="+signature,"Content-Type":"application/json"};
    const response=await request("https://api-gateway.coupang.com"+path+(params?"?"+params:""),{method,headers,body:body&&JSON.stringify(body),redirect:"error",signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Object.assign(Error("쿠팡 응답 "+response.status+" · WING에서 확인하세요."),{rejected:[400,401,403,422].includes(response.status)});
    // 긴 주문번호가 JavaScript 숫자로 반올림되기 전에 원문 식별자를 보존한다.
    const result=JSON.parse(await response.text(),(key,value,context)=>typeof value==="number"&&!Number.isSafeInteger(value)&&/^\d+$/.test(context.source)?context.source:value);
    if(query&&result.code===200&&Array.isArray(result.data))return result;
    if(result.code!=="SUCCESS")throw Error("쿠팡 요청 결과를 WING에서 확인하세요.");
    return result.data;
  }
  return {
    async records(day,kind){
      const rows=[];
      for(const status of kind==="orders"?["ACCEPT","INSTRUCT","DEPARTURE","DELIVERING","FINAL_DELIVERY","NONE_TRACKING"]:["settle"]){
        const settlement=status==="settle";
        const path=settlement?"/v2/providers/openapi/apis/api/v1/revenue-history":"/v2/providers/openapi/apis/api/v5/vendors/"+encodeURIComponent(env.ACC_COUPANG_VENDOR)+"/ordersheets";
        const query=settlement?{vendorId:env.ACC_COUPANG_VENDOR,recognitionDateFrom:day,recognitionDateTo:day,token:"",maxPerPage:"50"}:{createdAtFrom:day+"+09:00",createdAtTo:day+"+09:00",status,maxPerPage:"50"};
        const seen=new Set();
        for(;;){
          const result=await call("GET",path,undefined,query);
          for(const r of result.data){
            if(settlement){
              for(const i of r.items)rows.push({ref:String(r.orderId)+"-"+i.vendorItemId,group:String(r.orderId),name:i.vendorItemName,sku:i.externalSellerSkuCode,type:"product",status:r.saleType,qty:i.quantity,amount:i.settlementAmount});
              if(r.deliveryFee?.settlementAmount||!r.items.length)rows.push({ref:String(r.orderId),group:String(r.orderId),type:"delivery",status:r.saleType,amount:r.deliveryFee?.settlementAmount});
            }else for(const i of r.orderItems)rows.push({ref:String(r.orderId)+"-"+i.sequenceNo,group:String(r.orderId),settlementRef:String(r.orderId)+"-"+i.vendorItemId,sku:i.externalVendorSkuCode,name:i.vendorItemName,type:"product",status:r.status,qty:i.shippingCount,amount:i.orderPrice?.currencyCode==="KRW"?i.orderPrice.units:null});
          }
          if(!result.nextToken)break;
          if(seen.has(result.nextToken))throw Error("쿠팡 조회 커서가 반복되었습니다.");
          seen.add(result.nextToken);query[settlement?"token":"nextToken"]=result.nextToken;
        }
      }
      return rows;
    },
    async upload(page){
      return verifiedImage(page,request,env.ACC_COUPANG_IMAGE_ORIGIN);
    },
    async submit(page,profile,image){
      const {product,item}=JSON.parse(profile);
      if(!product?.displayCategoryCode||!item?.attributes||!item?.notices)throw Error("쿠팡 카테고리·옵션 속성·고시를 확인하세요.");
      const shipping=Number(page.shipping);
      const contents=[{contentsType:"TEXT",contentDetails:[{content:detailMarkup(page).replace(page.draft.image,image),detailType:"HTML"}]}];
      const offer={...item,itemName:page.option,externalVendorSku:"ACC-"+page.version,originalPrice:page.price,salePrice:page.price,
        maximumBuyCount:Number(page.draft.stock),images:[{imageOrder:0,imageType:"REPRESENTATION",vendorPath:image}],contents};
      delete offer.autoPricingInfo;
      const id=await call("POST",root+"seller-products",{...product,vendorId:env.ACC_COUPANG_VENDOR,sellerProductName:page.draft.title,
        displayProductName:page.draft.title,requested:true,deliveryChargeType:shipping?"NOT_FREE":"FREE",deliveryCharge:shipping,freeShipOverAmount:0,items:[offer]});
      if(!/^\d+$/.test(String(id)))throw Error("업체상품 등록번호를 확인하세요.");
      return String(id);
    },
    async read(id,page){
      if(!/^\d+$/.test(id))throw Error("업체상품번호를 확인하세요.");
      const product=await call("GET",root+"seller-products/"+id);
      if(product.vendorId!==env.ACC_COUPANG_VENDOR||product.items?.length!==1)throw Error("판매자와 옵션 수를 확인하세요.");
      const [item]=product.items;
      if(item.externalVendorSku!=="ACC-"+page.version)throw Error("승인 상품코드와 다릅니다.");
      if(product.statusName==="승인반려")return {sale:"rejected"};
      if(["상품삭제","판매중지"].includes(product.statusName))return {sale:"stopped"};
      if(product.statusName!=="승인완료"||!item.vendorItemId)return {sale:"pending"};
      if(!["NOT_FREE","FREE"].includes(product.deliveryChargeType))throw Error("배송 조건을 확인하세요.");
      const inv=await call("GET",root+"vendor-items/"+encodeURIComponent(item.vendorItemId)+"/inventories");
      if(inv.onSale!==true)return {sale:"stopped"};
      return {sale:"selling",option:item.itemName,price:inv.salePrice,extra:0,discount:0,stock:inv.amountInStock,shipping:product.deliveryChargeType==="FREE"?0:product.deliveryCharge};
    }
  };
}
module.exports={coupangProvider};
