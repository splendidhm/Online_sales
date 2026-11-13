"use strict";

const {detailMarkup}=require("./detail-editor");
const base="https://api.commerce.naver.com/external";
function naverProvider(request=fetch,token=process.env.ACC_NAVER_ACCESS_TOKEN){
  async function call(path,method,body){
    if(!token)throw Error("서버의 네이버 판매자 접근 토큰을 설정하세요.");
    const headers={Authorization:"Bearer "+token};
    if(body&&!(body instanceof FormData)){headers["Content-Type"]="application/json";body=JSON.stringify(body);}
    const res=await request(base+path,{headers,method,body,redirect:"error",signal:AbortSignal.timeout(30000)});
    if(!res.ok)throw Object.assign(Error("네이버 응답 "+res.status+" · 판매자센터 확인 필요"),{rejected:[400,401,403,422].includes(res.status)});
    return res.json();
  }
  return {
    async records(day,kind){
      const rows=[];
      if(kind==="settlements"){
        for(let page=1;;page++){
          const query=new URLSearchParams({searchDate:day,periodType:"SETTLE_CASEBYCASE_SETTLE_COMPLETE_DATE",pageNumber:String(page),pageSize:"100"});
          const result=await call("/v1/pay-settle/settle/case?"+query,"GET");
          if(!Array.isArray(result.elements)||!Number.isInteger(result.pagination?.totalPages))throw Error("네이버 정산 페이지를 확인하세요.");
          for(const r of result.elements)rows.push({ref:r.productOrderId??r.orderId,group:r.orderId,type:r.productOrderType,status:r.settleType,amount:r.settleExpectAmount});
          if(page>=result.pagination.totalPages)return rows;
        }
      }
      const query=new URLSearchParams({lastChangedFrom:day+"T00:00:00.000+09:00",lastChangedTo:day+"T23:59:59.999+09:00",limitCount:"100"});
      const seen=new Set();
      for(;;){
        const {data}=await call("/v1/pay-order/seller/product-orders/last-changed-statuses?"+query,"GET");
        if(!Array.isArray(data?.lastChangeStatuses))throw Error("네이버 변경 주문 내역을 확인하세요.");
        const ids=[...new Set(data.lastChangeStatuses.map(r=>r.productOrderId))];
        if(ids.length){
          const details=await call("/v1/pay-order/seller/product-orders/query","POST",{productOrderIds:ids});
          if(!Array.isArray(details.data))throw Error("네이버 주문 상세 응답을 확인하세요.");
          for(const {productOrder:r,order} of details.data)rows.push({ref:r.productOrderId,group:order?.orderId,status:r.productOrderStatus,
            name:r.productName,sku:r.sellerProductCode,qty:r.quantity,amount:r.totalPaymentAmount,type:"product"});
        }
        if(!data.more)return [...new Map(rows.map(row=>[row.ref,row])).values()];
        const {moreFrom,moreSequence}=data.more;
        const mark=JSON.stringify([moreFrom,moreSequence]);
        if(!moreFrom||moreSequence==null||seen.has(mark))throw Error("네이버 주문 다음 페이지를 확인하세요.");
        seen.add(mark);query.set("lastChangedFrom",moreFrom);query.set("moreSequence",moreSequence);
      }
    },
    async upload(page){
      const [type,encoded]=page.draft.image.split(",");
      const form=new FormData();
      const png=type.includes("png");
      form.append("imageFiles",new Blob([Buffer.from(encoded,"base64")],{type:png?"image/png":"image/jpeg"}),png?"product.png":"product.jpg");
      const result=await call("/v1/product-images/upload","POST",form);
      const image=result.images?.[0]?.url;
      if(typeof image!=="string"||!/^https:\/\/[^\s<>"']+$/.test(image))throw Error("네이버 등록 이미지 주소를 확인하세요.");
      return image;
    },
    async submit(page,profile,image){
      const {draft}=page;
      const settings=JSON.parse(profile);
      const {leafCategoryId,deliveryInfo,detailAttribute}=settings;
      if(!leafCategoryId||!deliveryInfo?.deliveryFee||!detailAttribute?.productInfoProvidedNotice||detailAttribute.optionInfo||detailAttribute.supplementProductInfo)throw Error("단일 구성 상품의 카테고리·배송·고시 설정을 확인하세요.");
      const shipping=Number(page.shipping);
      const deliveryFee={...deliveryInfo.deliveryFee,deliveryFeeType:shipping?"PAID":"FREE",baseFee:shipping};
      const detailContent=detailMarkup(page).replace(draft.image,image);
      const originProduct={statusType:"SALE",saleType:"NEW",leafCategoryId,name:draft.title,detailContent,
        images:{representativeImage:{url:image}},salePrice:page.price,stockQuantity:Number(draft.stock),
        deliveryInfo:{...deliveryInfo,deliveryFee},detailAttribute:{...detailAttribute,sellerCodeInfo:{sellerManagementCode:"ACC-"+page.version}}};
      const result=await call("/v2/products","POST",{originProduct,smartstoreChannelProduct:{naverShoppingRegistration:true,channelProductDisplayStatusType:"ON"}});
      if(!/^\d+$/.test(String(result.originProductNo)))throw Error("등록 결과의 원상품번호 확인 필요");
      return String(result.originProductNo);
    },
    async read(id,page){
      if(!/^\d+$/.test(id))throw Error("네이버 원상품번호를 확인하세요.");
      const {originProduct:p,smartstoreChannelProduct:channel}=await call("/v2/products/origin-products/"+id,"GET");
      if(!p||p.detailAttribute?.sellerCodeInfo?.sellerManagementCode!=="ACC-"+page.version||p.name!==page.draft.title)throw Error("판매자 관리코드 또는 상품명이 승인본과 다릅니다.");
      if(p.statusType==="REJECTION")return {sale:"rejected"};
      if(["WAIT","UNADMISSION"].includes(p.statusType)||channel?.channelProductDisplayStatusType==="WAIT")return {sale:"pending"};
      if(p.statusType!=="SALE"||channel?.channelProductDisplayStatusType!=="ON")return {sale:"stopped"};
      if(p.detailAttribute?.optionInfo||p.customerBenefit?.immediateDiscountPolicy||p.customerBenefit?.reservedDiscountPolicy)throw Error("옵션 또는 할인 조건을 판매자센터에서 대조하세요.");
      const fee=p.deliveryInfo?.deliveryFee;
      if(!["FREE","PAID"].includes(fee?.deliveryFeeType))throw Error("조회된 배송비 조건을 확인하세요.");
      return {sale:"selling",price:p.salePrice,stock:p.stockQuantity,shipping:fee.deliveryFeeType==="FREE"?0:fee.baseFee,extra:0,discount:0,option:page.option};
    }
  };
}
module.exports={naverProvider};
