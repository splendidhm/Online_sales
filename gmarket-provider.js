"use strict";
const {createHmac}=require("node:crypto");
const {detailMarkup}=require("./detail-editor");
const {verifiedImage}=require("./verified-image");

function esmReady(env=process.env){
  return Boolean(env.ACC_ESM_MASTER_ID&&env.ACC_ESM_SELLER_ID&&env.ACC_ESM_ISSUER&&env.ACC_ESM_SECRET);
}
function offer(page,profile,image){
  const {itemBasicInfo:basic,itemAddtionalInfo:add}=JSON.parse(profile);
  const category=basic?.category?.site;
  const shipping=add?.shipping;
  if(!add?.officialNotice?.officialNoticeNo||!add.officialNotice.details?.length||typeof add.isVatFree!=="boolean")
    throw Error("G마켓 상품정보고시와 과세 여부를 입력하세요.");
  if(category?.length!==1||category[0].siteType!==2||!category[0].catCode||
    !shipping?.policy?.placeNo||!shipping.companyNo||!shipping.dispatchPolicyNo?.gmkt||
    ![15,30,60,90].includes(add.sellingPeriod?.gmkt))
    throw Error("G마켓 단일 카테고리·출하지·택배사·발송정책·판매기간을 확인하세요.");
  const stock=Number(page.draft.stock),fee=Number(page.shipping);
  if(!Number.isInteger(stock)||stock<1||stock>99999||!Number.isInteger(page.price)||page.price<10||page.price%10||page.price>=1e9)
    throw Error("G마켓 판매가는 10원 단위이며 재고는 1~99,999개입니다. 계산서를 다시 확인하세요.");
  return {
    itemBasicInfo:{...basic,category:{...basic.category,site:category},goodsType:1,goodsName:{kor:page.draft.title}},
    itemAddtionalInfo:{...add,price:{gmkt:page.price},stock:{gmkt:stock},sellingPeriod:{gmkt:add.sellingPeriod.gmkt},
      managedCode:"ACC-"+page.version,recommendedOpts:{type:0},addonService:{addonServiceUseType:0},
      shipping:{...shipping,type:1,policy:{placeNo:shipping.policy.placeNo,feeType:2,each:{feeType:fee?2:1,feePayType:2,fee}}},
      images:{basicImgURL:image},descriptions:{kor:{type:2,html:detailMarkup(page).replace(page.draft.image,()=>image)}}},
    addtionalInfo:{sellerDiscount:{isUse:false},siteDiscount:{gmkt:false},overseaSales:{isAgree:false}}
  };
}
function gmarketProvider(request=fetch,env=process.env){
  async function call(method,path,body){
    if(!esmReady(env))throw Error("ESM 판매자 인증 설정을 확인하세요.");
    const encode=obj=>Buffer.from(JSON.stringify(obj)).toString("base64url");
    const claims={iss:env.ACC_ESM_ISSUER,sub:"sell",aud:"sa.esmplus.com",iat:Math.floor(Date.now()/1000),ssi:"G:"+env.ACC_ESM_SELLER_ID};
    const unsigned=encode({alg:"HS256",typ:"JWT",kid:env.ACC_ESM_MASTER_ID})+"."+encode(claims);
    const jwt=unsigned+"."+createHmac("sha256",env.ACC_ESM_SECRET).update(unsigned).digest("base64url");
    const res=await request("https://sa2.esmplus.com/item/v1/goods"+path,{method,headers:{Authorization:"Bearer "+jwt,"Content-Type":"application/json"},body:body&&JSON.stringify(body),redirect:"error",signal:AbortSignal.timeout(30000)});
    if(!res.ok)throw Object.assign(Error("ESM 응답 "+res.status+" · 판매자센터에서 확인하세요."),{rejected:[400,401,403,422].includes(res.status)});
    const data=await res.json();
    if(data.resultCode&&data.resultCode!==0)throw Object.assign(Error("ESM 처리 오류 "+Number(data.resultCode)+" · 판매자센터에서 확인하세요."),{rejected:data.resultCode===1000&&!data.goodsNo});
    return data;
  }
  return {
    async upload(page){
      offer(page,page.draft.marketProfile,"");
      return verifiedImage(page,request,env.ACC_ESM_IMAGE_ORIGIN);
    },
    async submit(page,profile,image){
      const result=await call("POST","",offer(page,profile,image));
      const site=result.siteDetail?.gmkt;
      if(!/^[1-9]\d*$/.test(result.goodsNo)||!/^[1-9]\d*$/.test(site?.SiteGoodsNo)||site.SiteGoodsComment!=="Success")
        throw Error("ESM 마스터상품번호와 G마켓 상품번호의 접수 결과를 확인하세요.");
      return {external:String(result.goodsNo),siteExternal:String(site.SiteGoodsNo)};
    },
    async read(id,page){
      if(!/^\d+$/.test(id))throw Error("ESM 마스터상품번호를 확인하세요.");
      const product=await call("GET","/"+id);
      const add=product.itemAddtionalInfo;
      if(add?.managedCode!=="ACC-"+page.version||product.itemBasicInfo?.goodsName?.kor!==page.draft.title)throw Error("G마켓 판매자 관리코드와 상품명이 승인본과 다릅니다.");
      if(product.isDisplayExclude===true)return {sale:"pending"};
      const status=await call("GET","/"+id+"/sell-status");
      const selling=(status.IsSell??status.isSell)?.gmkt;
      if(selling===false)return {sale:"stopped"};
      const policy=add.shipping?.policy,each=policy?.each,info=status.itemBasicInfo;
      if(selling!==true||product.isDisplayExclude!==false||add.recommendedOpts?.type!==0||(add.addonService?.addonServiceUseType??0)!==0||product.addtionalInfo?.sellerDiscount?.isUse!==false||
        policy?.feeType!==2||![1,2].includes(each?.feeType)||each.feeType===2&&each.feePayType!==2)
        throw Error("G마켓 노출·단일 구성·판매자 할인·배송 조건을 판매자센터에서 확인하세요.");
      return {sale:"selling",price:(info?.Price??info?.price)?.gmkt,stock:(info?.Stock??info?.stock)?.gmkt,
        shipping:each.feeType===1?0:each.fee,extra:0,discount:0,option:page.option};
    }
  };
}
module.exports={gmarketProvider,esmReady};
