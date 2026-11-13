"use strict";
const {screen}=require("./sourcing");
const endpoint="https://product.domeggook.com/api/v1/product/_search";
const number=value=>/^\d{1,9}$/.test(String(value))?Number(value):null;
const plain=value=>typeof value==="string"?value.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,4000):"";

function catalogRow(item,keyword){
  const code=String(item?.no??"");
  if(!/^[1-9]\d*$/.test(code)||!plain(item.title))throw Error("공급처에서 상품번호 또는 상품명을 확인할 수 없습니다.");
  const fee=item.deli?.supply;
  const license=item.desc?.license;
  const optionless=["","[]","{}"].includes(item.selectOpt);
  const unit=number(item.qty?.supplyUnit);
  const rights=typeof license?.usable==="boolean"?license.usable:null;
  const option=optionless&&unit===1?"기본 구성 1개":"";
  const freight=fee?.pay==="무료"?0:["고정배송비","고정"].includes(fee?.type)?number(fee.defaultFee??fee.fee):null;
  const price=String(item.price?.supply??"");
  const singlePrice=price.match(/^1\+(\d+)(?:\||$)/);
  const floor=number(item.price?.resale?.minimum);
  const detail=item.detail??{};
  return {code,name:plain(item.title),source:"https://domeme.domeggook.com/"+code,option,keywords:keyword,
    maker:plain(detail.manufacturer),model:plain(detail.model),floor,cost:optionless?number(singlePrice?.[1]??price):null,freight,
    minimum:unit,stock:number(item.qty?.inventory),direct:item.channel?.supply===true?true:null,
    resale:item.channel?.supply===true?true:null,rights,
    evidence:{supplierCode:code,rights:plain(license?.msg),origin:plain(detail.country),body:plain(item.desc?.contents?.item),returns:plain(item.desc?.contents?.deli),
      disclosure:Array.isArray(detail.infoDuty?.item)?detail.infoDuty.item.map(f=>[plain(f.name),plain(f.desc)].filter(Boolean).join(" · ")).join("\n").slice(0,4000):"",
      image:rights===true&&typeof item.thumb?.original==="string"?item.thumb.original:"",modified:plain(item.dateModify)}};
}

async function fetchCatalog({keyword,limit,code},request=fetch,key=process.env.ACC_SUPPLIER_KEY){
  if(!key)throw Error("도매매 상품정보 동기화 키를 서버에 설정하세요.");
  if(typeof keyword!=="string"||!keyword.trim()||keyword.length>100)throw Error("수집할 품목 검색어를 입력하세요.");
  if(!Number.isInteger(limit)||limit<1||limit>1000)throw Error("조회 수량은 1~1,000개입니다.");
  if(code&&!/^[1-9]\d*$/.test(code))throw Error("공급 상품번호를 확인하세요.");
  const query={bool:{must:[code?{terms:{no:[code]}}:{match:{title:keyword.trim()}}],filter:[{term:{"channel.supply":true}},{term:{adult:false}}]}};
  const rows=[],seen=new Set();
  let cursor;
  while(rows.length<limit){
    const size=Math.min(100,limit-rows.length);
    const response=await request(endpoint,{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},
      body:JSON.stringify({size,query,...(cursor?{search_after:cursor}:{})}),signal:AbortSignal.timeout(25000),redirect:"error"});
    if(!response.ok)throw Error("도매매 상품 조회 실패 ("+response.status+") · 권한과 승인 IP를 확인하세요.");
    const {result,data}=await response.json();
    if(result!==true||!Array.isArray(data?.list)||data.list.length>size)throw Error("도매매 상품 목록 응답을 확인하세요.");
    rows.push(...data.list.map(row=>catalogRow(row,keyword.trim())));
    cursor=data.searchAfter;
    if(!data.list.length||!Array.isArray(cursor)||!cursor.length||rows.length===limit)break;
    const mark=JSON.stringify(cursor);
    if(seen.has(mark))throw Error("공급처가 같은 페이지를 반환했습니다. 수집 회차를 다시 실행하세요.");
    seen.add(mark);
  }
  return {...screen(rows),provider:"domeme",keyword:keyword.trim(),fetched:new Date().toISOString()};
}
async function supplierImage(evidence,request=fetch,origins=process.env.ACC_SUPPLIER_IMAGE_ORIGINS||""){
  if(!evidence?.image)throw Error("사용 허가된 공급처 이미지가 없습니다.");
  const url=new URL(evidence.image);
  if(url.protocol!=="https:"||url.username||url.password||!origins.split(",").map(s=>s.trim()).includes(url.origin))throw Error("서버에서 공급처 사진의 허용 출처를 확인하세요.");
  const response=await request(url,{redirect:"error",signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error("공급처 사진을 불러올 수 없습니다.");
  const parts=[];
  let size=0;
  for await(const part of response.body){
    size+=part.length;if(size>2*1024*1024)throw Error("공급처 사진이 2MB를 초과합니다.");
    parts.push(part);
  }
  const bytes=Buffer.concat(parts);
  const sig=bytes.subarray(0,8).toString("hex");
  const type=sig==="89504e470d0a1a0a"?"png":sig.startsWith("ffd8ff")?"jpeg":null;
  if(!type)throw Error("공급처 사진이 PNG 또는 JPEG 형식인지 확인하세요.");
  return "data:image/"+type+";base64,"+bytes.toString("base64");
}
module.exports={fetchCatalog,catalogRow,supplierImage};
