"use strict";
const el = id => document.getElementById(id);
const labels={name:"상품명",maker:"제조사",model:"모델·제품 식별명",option:"규격·구성 수량",source:"공급 상품 주소",keywords:"유사 검색어 (품목·규격·구성)",top:"리뷰 상위 표본 수",shipping:"구매자 배송비 (원)",floor:"공급사 준수가격 (선택·원)",cost:"구성 전체 매입가 (원)",freight:"이번 주문에 적용되는 공급 배송비 (원)",freeAbove:"공급처 무료배송 매입액 기준 (선택·원)",grade:"네이버 매출 등급",category:"쿠팡 상품 분류"};
const choices={top:["5","10"],grade:["일반","영세","중소1","중소2","중소3"],category:["수납/정리용품","문구/사무용품 기본","광학용품(문구)","포토전용지"]};
const example={name:"서랍 정리함",maker:"연습 제조사",model:"A1",option:"중형 1개",keywords:"정리함 중형 1개",top:"5",shipping:0,cost:6000,freight:3000,grade:"일반",category:"수납/정리용품"};
function field(container, key, title, type) {
  const label = document.createElement("label"), input = document.createElement(choices[key]?"select":"input");
  label.textContent = title; input.name = key; if(choices[key]){input.append(new Option("선택",""));for(const v of choices[key])input.append(new Option(v,v));}else input.type=type;
  if (type === "number") {input.min = "0"; input.step = ["fee","target"].includes(key) ? "0.01" : "1";}
  label.append(input); el(container).append(label); return input;
}
const fields = {};
labels.gmarketCategory="G마켓 상품 분류";choices.gmarketCategory=["문구/사무용품","생활용품"];
for(const [key,label,hint] of [["demand","수요","확인한 주문 추세 등"],["supplier","공급사 신뢰도","출고·반품 대응 이력 등"],["difference","차별성","비교 상품과 다른 구성 등"]]){
  choices[key+"Level"]=["낮음","보통","높음"];
  fields[key+"Level"]=field("evidence",key+"Level",label+" 평가","text");
  fields[key+"Evidence"]=field("evidence",key+"Evidence",label+" 근거","text");
  fields[key+"Evidence"].placeholder=hint;
  for(const suffix of ["Level","Evidence"])fields[key+suffix].addEventListener("input",()=>{save();render();});
}
for (const [key,title] of Object.entries(labels)) {
  const type = ["name","option","maker","model","keywords"].includes(key) ? "text" : key === "source" ? "url" : "number";
  fields[key] = field(!["cost","freight","freeAbove","grade","category"].includes(key) ? "product" : "costs",key,title,type);
  fields[key].addEventListener("input", () => {save(); render();});
}
for (const [key,title,type] of [["title","표본 상품명","text"],["maker","표본 제조사","text"],["model","표본 모델·식별명","text"],["reviews","리뷰 수","number"],["seller","판매자","text"],["url","상품 링크","url"],["option","확인한 규격·수량","text"],["price","상품가 (원)","number"],["shipping","배송비 (원)","number"],["time","확인 시각 (한국시간)","datetime-local"]]) {
  field("sample",key,title,type).required = !["maker","model","reviews"].includes(key);
}
let samples = [];
const storageKey = () => ["acc.worksheet.v1",el("mode").value,el("channel").value].join(".");
const values = () => Object.fromEntries(Object.entries(fields).map(([key,input]) => [key,input.value]));
const won = n => n.toLocaleString("ko-KR")+"원";
function save(){
  try {localStorage.setItem(storageKey(),JSON.stringify({input:values(),samples}));el("saved").textContent="이 브라우저에 저장됨";}
  catch {el("saved").textContent="저장 실패 · 브라우저 저장 권한을 확인하세요.";}
}
function load(){
  let data; el("saved").textContent="";
  try {data=JSON.parse(localStorage.getItem(storageKey()));}
  catch {el("saved").textContent="저장한 계산서를 읽을 수 없습니다.";}
  const input=data?.input ?? (el("mode").value==="fixture" ? example : {});
  for(const [key,field] of Object.entries(fields)) field.value=input[key] ?? "";
  samples=data?.samples ?? []; el("form").reset();
  el("form").elements.time.value=new Date(Date.now()+9*3600000).toISOString().slice(0,16);
  render();
}
function render(){
  const channel=el("channel").value;
  fields.gmarketCategory.parentElement.hidden=channel!=="G마켓";
  fields.grade.parentElement.hidden=channel!=="네이버";fields.category.parentElement.hidden=channel!=="쿠팡";
  const data=values();
  const search={"네이버":"https://search.shopping.naver.com/search/all?query=","쿠팡":"https://www.coupang.com/np/search?q=","G마켓":"https://www.gmarket.co.kr/n/search?keyword="}[channel];
  for(const [id,query] of [["exactSearch",[data.maker,data.model,data.option].filter(Boolean).join(" ")],["similarSearch",data.keywords]]){
    el(id).href=search+encodeURIComponent(query);el(id).hidden=!query;
  }
  el("feeSource").href=feeSources[channel];
  el("feeDate").textContent=feeEstimate(channel,data,0,0).checked;
  el("list").replaceChildren();
  el("assessment").replaceChildren();
  samples.forEach((s,index)=>{
    const row=document.createElement("li"), button=document.createElement("button");
    row.textContent=[s.seller,s.option,won(Number(s.price)+Number(s.shipping)),s.time.replace("T"," "),s.url,classify(data,s)||"미분류",s.reviews ? "리뷰 "+s.reviews+"개" : ""].join(" · ");
    button.textContent="삭제";button.onclick=()=>{samples.splice(index,1);save();render();};
    row.append(button);el("list").append(row);
  });
  try {
    const r=evaluate(data,samples,channel);
    const a=r.assessment;
    el("assessment").textContent="근거 충족률 "+a.coverage+"% · 종합 "+(a.total===null?"평가 대기":a.total+"점")+" · 가격 경쟁강도 "+a.strength;
    for(const f of a.factors){
      const line=document.createElement("p");
      line.textContent=f.label+" ("+f.weight+"%) · "+(f.score===null?"미확인":f.score.toFixed(1)+"점")+" — "+f.reason;
      el("assessment").append(line);
    }
    el("profit").textContent=r.profit===null?"산출 대기":won(r.profit)+" · "+r.margin.toFixed(1)+"%";
    el("summary").textContent="적용 배송비 "+won(r.appliedFreight)+" · "+r.policy.label+(r.reference!==null && r.policy.fee!==null?" · 예상 수수료 "+won(r.policy.fee):"");
    el("market").textContent="동일 "+r.exact+"건 · 유사 "+r.similar+"건 · "+(r.reference===null?"시장 표본 필요":r.basis+" 표본 배송포함 중앙값 "+won(r.median)+" → 제안 판매가 "+won(r.reference));
  } catch(error){el("profit").textContent="입력 확인";el("summary").textContent=error.message;el("market").textContent="";}
}
el("form").onsubmit=e=>{
  e.preventDefault();const form=e.currentTarget, s=Object.fromEntries(new FormData(form));
  if (!s.seller.trim() || !s.option.trim() || !/^https?:\/\//i.test(s.url)){alert("판매자·규격과 HTTP(S) 상품 링크를 확인하세요.");return;}
  try {amount(s.price);amount(s.shipping);} catch(error){alert(error.message);return;}
  s.match=Boolean(s.match);samples.push(s);save();load();
};
el("mode").onchange=load;el("channel").onchange=load;load();
