function amount(value){
  if(!/^\d{1,9}$/.test(String(value)))throw Error("금액·리뷰 수를 0 이상 정수로 입력하세요.");
  return Number(value);
}
const clean=value=>String(value??"").normalize("NFKC").toLowerCase().replace(/\s+/g,"").trim();
const feeSources={
  "네이버":"https://help.sell.smartstore.naver.com/faq/content.help?faqId=3558",
  "쿠팡":"https://cloud.mkt.coupang.com/Fee-Table?rf=MARKETPLACE"
};
function feeEstimate(channel,input,goods,shipping){
  const dated={source:feeSources[channel],checked:"2026-11-11"};
  if(channel==="네이버"){
    const grades={"일반":3630,"영세":1947,"중소1":2563,"중소2":2728,"중소3":3003};
    const rate=grades[input.grade];
    if(typeof rate!=="number")return {...dated,label:"Npay 매출 등급 확인 필요",fee:null};
    return {...dated,label:input.grade+" · Npay "+rate/1000+"% + 일반 쇼핑 유입 판매수수료 3%",fee:Math.ceil((goods+shipping)*rate/100000)+Math.ceil(goods*3/100)};
  }
  const rates={"수납/정리용품":1080,"문구/사무용품 기본":1080,"광학용품(문구)":880,"포토전용지":780};
  const rate=rates[input.category];
  if(typeof rate!=="number" || shipping>0)return {...dated,label:"쿠팡 세부 분류 또는 유료 배송 수수료 확인 필요",fee:null};
  return {...dated,label:input.category+" · "+rate/100+"% + 수수료 부가세",fee:Math.ceil(goods*rate*11/100000)};
}
function classify(input,s){
  if(!s.match || !s.title || !s.option)return "";
  const same=(key)=>clean(input[key]) && clean(input[key])===clean(s[key]);
  if(same("maker") && same("model") && same("option"))return "동일";
  const terms=String(input.keywords??"").trim().split(/\s+/).filter(Boolean);
  if(!terms.length || !terms.every(t=>clean(s.title+" "+s.option).includes(clean(t))))return "";
  return /^\d{1,9}$/.test(String(s.reviews)) ? "유사" : "";
}
const assessmentFactors = [
  {key:"profitability",label:"수익성",weight:30},
  {key:"demand",label:"수요",weight:25},
  {key:"competition",label:"가격 경쟁력",weight:20},
  {key:"supplier",label:"공급사 신뢰도",weight:15},
  {key:"difference",label:"차별성",weight:10}
];

function assessCandidate(input, result, selected) {
  const offers = new Map();
  for (const sample of selected) {
    const seller = clean(sample.seller);
    if (seller) offers.set(seller, Math.min(offers.get(seller) ?? Infinity, sample.total));
  }
  const buyerTotal = result.reference === null ? null : result.reference + amount(input.shipping);
  const cheaper = [...offers.values()].filter(price => price * 100 <= buyerTotal * 95).length;
  const competitive = offers.size >= 3 && buyerTotal !== null;
  const share = competitive ? cheaper / offers.size : null;
  const strength = !competitive ? "미확인" : share >= 2/3 ? "높음" : share >= 1/3 ? "보통" : "낮음";
  const levels = {"낮음":20,"보통":60,"높음":100};
  const factors = assessmentFactors.map(factor => {
    let score=null,reason;
    if (factor.key === "profitability") {
      score=result.margin===null ? null : Math.min(100,Math.max(0,result.margin));
      reason=result.margin===null ? "시장 제안가 또는 수수료 확인 필요" : "예상 이익률 "+result.margin.toFixed(1)+"%";
    } else if (factor.key === "competition") {
      score=competitive ? 100*(1-share) : null;
      reason=competitive ? "배송포함가가 5% 이상 낮은 판매자 "+cheaper+"/"+offers.size+"곳" : "서로 다른 판매자 "+offers.size+"곳 · 최소 3곳 필요";
    } else {
      const level=input[factor.key+"Level"];
      const note=String(input[factor.key+"Evidence"]??"").trim();
      if (Object.hasOwn(levels,level) && note) {
        score=levels[level]; reason=level+" · "+note;
      } else reason=note ? "평가 등급 미선택 · "+note : "평가 근거 미입력";
    }
    return {...factor,score,reason};
  });
  const coverage=factors.reduce((sum,f)=>sum+(f.score===null?0:f.weight),0);
  const total=coverage===100 ? Math.round(factors.reduce((sum,f)=>sum+f.score*f.weight,0)/100) : null;
  return {version:1,factors,coverage,total,strength};
}
function evaluate(input,samples,channel){
  const top=Number(input.top||5);
  if(![5,10].includes(top))throw Error("리뷰 표본 수는 5 또는 10을 선택하세요.");
  const groups={"동일":[],"유사":[]},seen=new Set();
  for(const s of [...samples].sort((a,b)=>String(b.time).localeCompare(String(a.time)))){
    if(seen.has(s.url))continue;
    seen.add(s.url);
    const group=classify(input,s);
    if(group)groups[group].push({...s,total:amount(s.price)+amount(s.shipping)});
  }
  groups["유사"].sort((a,b)=>Number(b.reviews)-Number(a.reviews)||a.url.localeCompare(b.url));
  groups["유사"]=groups["유사"].slice(0,top);
  const basis=groups["동일"].length?"동일":"유사";
  const prices=groups[basis].map(s=>s.total).sort((a,b)=>a-b);
  const mid=Math.floor(prices.length/2);
  const median=prices.length?Math.round((prices[mid]+prices[Math.floor((prices.length-1)/2)])/2):null;
  const shipping=amount(input.shipping),cost=amount(input.cost),freight=amount(input.freight);
  const floor=amount(input.floor||0);
  const reference=median===null?null:Math.max(1,floor,median-shipping);
  const policy=feeEstimate(channel,input,reference??0,shipping);
  const appliedFreight=input.freeAbove && cost>=amount(input.freeAbove)?0:freight;
  const profit=reference===null||policy.fee===null?null:reference+shipping-cost-appliedFreight-policy.fee;
  const result={version:2,appliedFreight,basis,prices,exact:groups["동일"].length,similar:groups["유사"].length,selected:groups[basis].map(s=>s.url),median,reference,policy,profit,margin:profit===null?null:profit*100/(reference+shipping)};
  result.assessment=assessCandidate(input,result,groups[basis]);
  return result;
}
if(typeof module!=="undefined")module.exports={evaluate,classify};
