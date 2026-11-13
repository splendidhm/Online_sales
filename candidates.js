"use strict";
if(location.protocol==="http:"){
  el("candidates").hidden=false;
  if(location.hash.length>1&&!["#sourcing","#worksheet","#candidates","#operations"].includes(location.hash)){
    sessionStorage.setItem("acc.admin",location.hash.slice(1));
    history.replaceState(null,"",location.pathname);
  }
  let opened=null, generation=0;
  async function api(path,body){
    const headers={Authorization:"Bearer "+(sessionStorage.getItem("acc.admin")??"")};
    const opts={headers};
    if(body){opts.method="POST";headers["Content-Type"]="application/json";opts.body=JSON.stringify(body);}
    const response=await fetch(path,opts);
    const result=await response.json();
    if(!response.ok)throw Error(result.error);
    return result;
  }
  el("autoResearch").hidden=false;
  el("autoResearch").onclick=async()=>{
    const button=el("autoResearch");button.disabled=true;
    const state=()=>JSON.stringify([values(),el("mode").value,el("channel").value]);
    const initial=state();
    try{
      const found=await api("/api/research",{input:values(),channel:el("channel").value});
      if(initial!==state())throw Error("조사 중 상품이 변경되었습니다. 다시 조회하세요.");
      const merged=new Map(samples.map(s=>[s.url,s]));
      for(const s of found)merged.set(s.url,s);
      samples=[...merged.values()];save();render();
      el("researchStatus").textContent="공급처 조회 "+found.length+"건 · 중복 링크 통합 완료";
    }catch(e){el("researchStatus").textContent=e.message;}finally{button.disabled=false;}
  };
  const openStudio=detailEditor(api);
  el("demoProduct").onclick=async()=>{
    const b=el("demoProduct");b.disabled=true;
    try{
      const {id}=await api("/api/demo",{mode:"fixture"});
      if(el("mode").value==="fixture"){await refresh();await openStudio(id);}
    }catch(e){batchMessage(e.message);}finally{b.disabled=false;}
  };
  operationsPanel(api);
  api("/api/connections").then(result=>{
    const names={supplier:"도매매",research:"시장조사",content:"AI 제작·검수",naver:"스마트스토어",coupang:"쿠팡",gmarket:"G마켓"};
    el("connections").textContent=Object.entries(result).map(([k,v])=>names[k]+" "+(v?"설정됨":"미설정")).join(" · ");
  }).catch(e=>{el("connections").textContent=e.message;});
  function alertMessage(text){el("notice").textContent=text;}
  let batch=null, visibleCount=20, batchRequest=0;
  const batchMessage=text=>{el("batchSummary").textContent=text;};
  async function inspectProduct(product){
    const channel=el("channel").value;
    const mode=el("mode").value;
    const rows=await api("/api/candidates?mode="+mode);
    if(el("mode").value!==mode || el("channel").value!==channel)return;
    const existing=rows.find(row=>row.channel===channel && row.input.source===product.source && row.input.option===product.option);
    if(existing){openRow(existing);return;}
    opened={mode,channel,id:0,batchId:Number(el("batchHistory").value),input:{option:product.option,source:product.source,name:product.name}};
    for(const [key,input] of Object.entries(fields))input.value=product[key]??"";
    samples=[];el("checks").checked=false;save();render();
    fields.maker.focus();
    alertMessage("공급 조건을 불러왔습니다. 판매 조건과 비교 표본을 입력하세요.");
  }
  function displayBatch(){
    el("batchRows").replaceChildren();el("showMore").hidden=true;
    if(!batch){batchMessage("저장된 수집 회차가 없습니다.");return;}
    batchMessage(Object.entries(batch.counts).map(([label,count])=>label+" "+count+"건").join(" · "));
    const rows=batch.rows.filter(row=>row.status===el("batchFilter").value);
    for(const product of rows.slice(0,visibleCount)){
      const li=document.createElement("li");
      li.textContent=[product.name,product.option,product.cost==null?"매입가 미확인":won(product.cost),product.reason].join(" · ");
      if(product.status==="조사 대상"||el("mode").value==="manual"&&product.status==="보완"){
        const button=document.createElement("button");button.textContent="계산서 열기";
        button.onclick=()=>inspectProduct(product).catch(e=>batchMessage(e.message));
        li.append(button);
      }
      el("batchRows").append(li);
    }
    if(!rows.length)el("batchRows").textContent="해당 결과가 없습니다.";
    el("showMore").hidden=rows.length<=visibleCount;
  }
  async function readBatch(){
    const ticket=++batchRequest, id=el("batchHistory").value;
    const snapshot=id ? await api("/api/batches?mode="+el("mode").value+"&id="+encodeURIComponent(id)) : null;
    if(ticket!==batchRequest)return;
    batch=snapshot;visibleCount=20;displayBatch();
  }
  async function historyList(id){
    const mode=el("mode").value;
    const history=await api("/api/batches?mode="+mode);
    if(mode!==el("mode").value)return;
    el("batchHistory").replaceChildren(...history.map(row=>new Option(row.id+"회차 · "+row.total+"건",row.id)));
    if(id)el("batchHistory").value=id;
    await readBatch();
  }
  el("batchForm").onsubmit=async event=>{
    event.preventDefault();el("collect").disabled=true;
    try{
      const mode=el("mode").value;
      let payload={mode,limit:Number(el("batchLimit").value)};
      if(mode==="manual"){
        const file=el("supplierFile").files[0];
        if(!file)throw Error("공급처 JSON 파일을 선택하세요.");
        payload={mode,items:JSON.parse(await file.text())};
      }
      const result=await api("/api/batches",payload);
      if(mode!==el("mode").value)return;
      el("batchFilter").value="조사 대상";await historyList(result.id);
    }catch(e){batchMessage(e.message);}finally{el("collect").disabled=false;}
  };
  el("batchHistory").onchange=()=>readBatch().catch(e=>batchMessage(e.message));
  el("supplierSearch").onsubmit=async event=>{
    event.preventDefault();
    const form=event.currentTarget;form.inert=true;
    try{
      const result=await api("/api/batches",{mode:"manual",provider:"domeme",keyword:el("supplierQuery").value,limit:Number(el("supplierCount").value)});
      if(el("mode").value==="manual"){
        el("batchFilter").value=result.counts["조사 대상"]?"조사 대상":"보완";await historyList(result.id);
      }
    }catch(e){batchMessage(e.message);}finally{form.inert=false;}
  };
  el("batchFilter").onchange=()=>{visibleCount=20;displayBatch();};
  el("showMore").onclick=()=>{visibleCount+=20;displayBatch();};
  function showSourcing(){
    const manual=el("mode").value==="manual";
    el("demoProduct").hidden=manual;
    el("supplierSearch").hidden=!manual;
    el("sourcing").hidden=false;el("supplierLabel").hidden=!manual;el("batchLimit").parentElement.hidden=manual;
    el("collect").textContent=manual?"공급 자료 선별":"모의 회차 생성";
    batchRequest++;batch=null;displayBatch();
    historyList().catch(e=>batchMessage(e.message));
  }
  el("mode").addEventListener("change",showSourcing);showSourcing();
  function openRow(row){
    opened=row;
    el("channel").value=row.channel;
    for(const [key,input] of Object.entries(fields)) input.value=row.input[key]??"";
    samples=structuredClone(row.samples);el("checks").checked=row.checks;
    save();render();alertMessage("저장된 계산서 "+row.id+"번을 열었습니다.");
    el("product").scrollIntoView({behavior:"smooth"});
  }
  async function refresh(){
    const ticket=++generation;
    const rows=await api("/api/candidates?mode="+el("mode").value);
    if(ticket!==generation)return;
    el("rows").replaceChildren();
    for(const row of rows){
      const tr=el("rows").insertRow();
      const assessment=row.result.assessment;
      const total=assessment?.total;
      for(const text of [row.input.name+" · "+row.input.option,row.channel,row.result.version>=2?(row.result.reference===null?"조사 대기":won(row.result.reference)):won(Number(row.input.price))+" (이전)",row.result.profit===null?"산출 대기":won(row.result.profit)+" ("+row.result.margin.toFixed(1)+"%)",row.result.prices.length+"건",assessment?.strength??"미평가",assessment?assessment.coverage+"%":"미평가",total==null?"평가 대기":total+"점",row.choice??"검토 대기"])tr.insertCell().textContent=text;
      const actions=tr.insertCell();
      function button(label,click){const b=document.createElement("button");b.textContent=label;b.onclick=async()=>{try{await click();}catch(e){alertMessage(e.message);}};actions.append(b);}
      button("열기",()=>openRow(row));
      if(row.choice==="진행")button("상세페이지 제작",()=>openStudio(row.id));
      if(!row.choice)for(const choice of ["진행","보류","제외"])button(choice,async()=>{
        const unchanged=opened?.id===row.id && Object.keys(fields).every(k=>String(row.input[k]??"")===fields[k].value) &&
          JSON.stringify(samples)===JSON.stringify(row.samples) && el("checks").checked===row.checks;
        if(!unchanged){alertMessage("행의 ‘열기’로 저장본을 확인하세요. 편집한 내용은 먼저 저장하세요.");return;}
        await api("/api/decision",{id:row.id,choice});await refresh();
        if(opened?.id===row.id)opened.choice=choice;
        alertMessage(row.input.name+" · "+choice+" 결정 저장됨");
      });
    }
    if(!rows.length)el("rows").insertRow().insertCell().textContent="저장된 후보가 없습니다.";
  }
  el("storeCandidate").onclick=async()=>{
    try{
      const input=values(),channel=el("channel").value,mode=el("mode").value;
      const same=opened && opened.channel===channel && opened.mode===mode &&
        opened.input.option===input.option && opened.input.source===input.source &&
        (input.source || opened.input.name===input.name);
      const payload={input,channel,mode,samples:structuredClone(samples),checks:el("checks").checked,base:same?opened.id:0,review:Boolean(same && opened.choice)};
      if(opened?.batchId&&opened.input.source===input.source&&(same||!opened.id&&!opened.input.option))payload.batchId=opened.batchId;
      const {id}=await api("/api/candidates",payload);
      opened={...payload,id};await refresh();alertMessage("계산서 "+id+"번을 저장했습니다.");
    }catch(e){alertMessage(e.message);}
  };
  el("freshCandidate").onclick=()=>{
    opened=null;el("checks").checked=false;
    for(const input of Object.values(fields))input.value="";
    samples=[];save();render();alertMessage("새 후보의 상품명과 조건을 입력하세요.");fields.name.focus();
  };
  for(const id of ["mode","channel"])el(id).addEventListener("change",()=>{
    opened=null;el("checks").checked=false;alertMessage("");refresh().catch(e=>alertMessage(e.message));
  });
  refresh().catch(e=>alertMessage(e.message));
}
