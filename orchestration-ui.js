"use strict";

function orchestrationPanel(api, openDraft){
  const endpoint="/api/orchestration/runs";
  const panel=el("orchestration");
  const form=el("orchestrationStart");
  const runs=el("orchestrationRuns");
  const status=el("orchestrationStatus");
  const detail=el("orchestrationDetail");
  const excel=el("orchestrationExcel");
  const channels=["네이버","쿠팡"];
  const statusLabels={PENDING:"대기",RUNNING:"진행 중",VALIDATING:"검증 중",REVISION_REQUIRED:"재작업 요청",APPROVED:"검증 통과",REJECTED:"추천 제외",BLOCKED:"보완 대기",COMPLETED:"완료",FAILED:"실패",PASS:"통과",REVISE:"수정 필요",FAIL:"실패",UNVERIFIED:"미확인",EXCLUDED:"제외"};
  const roleLabels={leader:"팀 리더",research:"시장조사",validation:"독립 검증",analysis:"사업성 분석"};
  const fieldLabels={cost:"공급가",freight:"공급 배송비",direct:"직배송",rights:"이미지 사용 권리",resale:"재판매",stock:"재고",minimum:"최소 주문량",option:"옵션",samples:"시장 표본",origin:"원산지",disclosure:"상품정보고시",certification:"인증",source:"공급 출처",time:"확인 시각",fee:"수수료"};
  const active=new Set(["PENDING","RUNNING","VALIDATING","REVISION_REQUIRED","APPROVED"]);
  const mode=()=>el("mode").value;
  const query=()=>"?mode="+encodeURIComponent(mode());
  const label=value=>statusLabels[value]??value??"미확인";
  const role=value=>roleLabels[String(value).toLowerCase()]??value;
  const knownNumber=value=>value!=null&&value!==""&&Number.isFinite(Number(value));
  const money=value=>knownNumber(value)?won(Number(value)):"미확인";
  const ratio=value=>knownNumber(value)?Number(value).toFixed(1)+"%":"미확인";
  const localTime=value=>{
    if(!value)return "미확인";
    if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return value.replace("T"," ");
    const date=new Date(String(value).replace(" ","T").replace(/^([\d-]+T[\d:]+)$/,"$1Z"));
    return Number.isNaN(+date)?value:date.toLocaleString("ko-KR",{timeZone:"Asia/Seoul",hourCycle:"h23"});
  };
  const message=value=>{status.textContent=value;};
  const make=(tag,content)=>{
    const node=document.createElement(tag);
    if(content!=null)node.textContent=content;
    return node;
  };
  let timer, ticket=0, enabled=false, current=null, savedView="";
  const notes=new Map();

  function input(title,name,options={}){
    const row=make("label",title+" ");
    let control;
    if(options.choices){
      control=make("select");
      if(options.placeholder)control.append(new Option(options.placeholder,""));
      for(const value of options.choices)control.append(new Option(value,value));
    }else{
      control=make(options.multiline?"textarea":"input");
      if(!options.multiline)control.type=options.type??"text";
    }
    control.name=name;
    control.required=Boolean(options.required);
    if(options.maxLength)control.maxLength=options.maxLength;
    if(options.type==="number"){control.min="0";control.max="999999999";control.step="1";}
    if(options.value!=null)control.value=options.value;
    row.append(control);
    return row;
  }

  const grade=input("네이버 매출 등급","naverGrade",{choices:choices.grade,placeholder:"등급 확인 필요"});
  const category=input("쿠팡 상품 분류","coupangCategory",{choices:choices.category,placeholder:"분류 확인 필요"});
  const naverShipping=input("네이버 구매자 배송비 (원)","naverShipping",{type:"number",required:true,value:"0"});
  const coupangShipping=input("쿠팡 구매자 배송비 (원)","coupangShipping",{type:"number",required:true,value:"0"});
  el("orchestrationSettings").append(grade,naverShipping,category,coupangShipping);
  function selectedChannels(){return form.elements.market.value==="all"?channels:[form.elements.market.value];}
  function syncSettings(){
    const selected=selectedChannels();
    for(const [channel,items] of [["네이버",[grade,naverShipping]],["쿠팡",[category,coupangShipping]]]){
      for(const item of items){
        item.hidden=!selected.includes(channel);
        item.lastElementChild.disabled=item.hidden;
      }
    }
    if(mode()==="fixture"){
      if(!form.elements.naverGrade.value)form.elements.naverGrade.value="일반";
      if(!form.elements.coupangCategory.value)form.elements.coupangCategory.value=choices.category[0];
    }
  }

  function table(headers,rows){
    const wrapper=make("div");
    wrapper.className="orchestration-table";
    const node=make("table");
    const heading=node.createTHead().insertRow();
    for(const title of headers){
      const th=make("th",title);th.scope="col";heading.append(th);
    }
    const body=node.createTBody();
    for(const cells of rows){
      const tr=body.insertRow();
      for(const cell of cells){
        const td=tr.insertCell();
        if(cell instanceof Node)td.append(cell);else td.textContent=cell??"미확인";
      }
    }
    wrapper.append(node);
    return wrapper;
  }

  function sourceLink(value){
    if(!value)return "미확인";
    try{
      const url=new URL(value);
      if(!["http:","https:"].includes(url.protocol)||url.username||url.password)return "확인되지 않은 주소";
      const link=make("a","출처 열기");
      link.href=url.href;link.target="_blank";link.rel="noopener noreferrer";
      return link;
    }catch{return "확인되지 않은 주소";}
  }

  function details(title,content,key){
    const block=make("details");
    block.dataset.key=key;
    block.append(make("summary",title),content);
    return block;
  }

  async function loadBatches(){
    const dataMode=mode();
    const batch=form.elements.batchId;
    const prior=batch.value;
    const rows=await api("/api/batches"+query());
    if(dataMode!==mode())return;
    batch.replaceChildren(new Option(rows.length?"회차 선택":"저장된 수집 회차 없음",""),...rows.map(row=>new Option(row.id+"회차 · "+row.total+"건",row.id)));
    if(rows.some(row=>String(row.id)===prior))batch.value=prior;
    else if(rows.length)batch.value=rows[0].id;
    form.querySelector("button[type=submit]").disabled=!rows.length;
  }

  function queueRefresh(record){
    clearTimeout(timer);
    if(record?.id===current?.id && record?.mode===mode() &&
      (active.has(record.status)||record.candidates?.some(candidate=>active.has(candidate.status)))){
      timer=setTimeout(()=>{
        if(detail.contains(document.activeElement)&&document.activeElement.closest("form")){queueRefresh(record);return;}
        refresh(false).catch(error=>{message(error.message);queueRefresh(record);});
      },2000);
    }
  }

  async function refresh(refreshList=true,id){
    const generation=++ticket;
    if(refreshList){
      const list=await api(endpoint+query());
      if(generation!==ticket)return;
      const selected=String(id??runs.value);
      runs.replaceChildren(...list.map(run=>new Option(run.id+"회차 · 공급 "+run.batchId+"회차 · "+label(run.status),run.id)));
      if(list.some(run=>String(run.id)===selected))runs.value=selected;
    }
    if(!runs.value){
      current=null;excel.disabled=true;detail.replaceChildren();savedView="";
      message("선택한 자료 종류에 분석 회차가 없습니다.");
      return;
    }
    const record=await api(endpoint+"/"+encodeURIComponent(runs.value)+query());
    if(generation!==ticket)return;
    current=record;
    if(runs.selectedOptions[0])runs.selectedOptions[0].textContent=record.id+"회차 · 공급 "+record.batchId+"회차 · "+label(record.status);
    excel.disabled=false;
    message("분석 "+record.id+"회차 · "+label(record.status)+" · 상품·마켓 "+record.completed+"/"+record.total+"건 처리 · "+(record.ai?"AI 설명 사용":record.mode==="fixture"?"모의 자료":"규칙과 확인 자료로 분석"));
    const version=JSON.stringify(record);
    if(savedView!==version){savedView=version;show(record);}
    queueRefresh(record);
  }

  function sampleView(candidate){
    const validation=candidate.validation;
    const samples=validation?.samples??candidate.samples??[];
    const content=make("div");
    if(samples.length){
      content.append(table(["상품·옵션","제조사·모델","판매처","등급·검증","리뷰","정상가","행사가·조건","배송비","총 구매가","조사 시각","출처"],samples.map(sample=>[
        [sample.title,sample.option,sample.quantity==null?"":sample.quantity+"개"].filter(Boolean).join(" · "),
        [sample.maker,sample.model].filter(Boolean).join(" · ")||"미확인",sample.seller,
        [sample.grade,sample.verification,sample.verificationReason].filter(Boolean).map(label).join(" · ")||"검증 대기",
        sample.reviews,money(sample.regularPrice??sample.price),[money(sample.promoPrice),sample.condition].filter(Boolean).join(" · "),money(sample.shipping),
        money(sample.total??(sample.price!=null&&sample.shipping!=null?Number(sample.price)+Number(sample.shipping):null)),localTime(sample.time),sourceLink(sample.url)
      ])));
    }else content.append(make("p","수집된 시장 표본이 없습니다."));
    return content;
  }

  function analysisView(candidate){
    const item=candidate.analysis;
    const result=item.result??{};
    const content=make("div");
    const dist=item.distribution??{};
    content.append(make("p","기준가 "+money(result.reference)+" · 예상 공헌이익 "+money(result.profit)+" ("+ratio(result.margin)+") · 경쟁강도 "+(result.assessment?.strength??"미확인")),
      make("p","배송포함 시장가 "+money(dist.min)+" ~ "+money(dist.max)+" · 중앙값 "+money(dist.median??result.median)+" · 최저가 대비 "+ratio(dist.versusMinPercent)),
      make("p","손익분기 판매가 "+money(item.breakEven)+(item.breakEvenReason?" · "+item.breakEvenReason:"")),
      make("p",result.policy?.label??"수수료 정책 미확인"));
    if(Array.isArray(item.scenarios)&&item.scenarios.length){
      content.append(table(["시나리오","판매가","예상 이익","예상 이익률","사유"],item.scenarios.map(row=>[
        row.label??row.name,money(row.price??row.goods),money(row.profit),ratio(row.margin),row.reason??""
      ])));
    }
    return content;
  }

  function issueRows(issues){
    return table(["항목","기존 값","사유","필요한 보완","출처"],issues.map(issue=>[
      fieldLabels[issue.field]??issue.field,
      typeof issue.value==="object"&&issue.value!==null?JSON.stringify(issue.value):issue.value,
      issue.reason,issue.required,sourceLink(issue.source)
    ]));
  }

  function supplementView(record,candidate){
    const helper=make("form");
    const key=record.id+"-"+candidate.id;
    const draft=notes.get(key)??{};
    const supply=make("fieldset"), supplyInputs=make("div");
    supplyInputs.className="grid";
    supply.append(make("legend","공급 원본 확인"),supplyInputs);
    const fields=[
      ["공급 상품 주소","source",{type:"url",value:candidate.input.source}],
      ["확인 시각 (한국시간)","time",{type:"datetime-local",value:new Date(Date.now()+9*3600000).toISOString().slice(0,16)}],
      ["원산지","origin",{}],["상품정보고시 근거","disclosure",{}],["인증 또는 비대상 근거","certification",{}],["재판매·이미지 사용 권리 근거","rights",{}]
    ];
    for(const [title,name,options] of fields)supplyInputs.append(input(title,name,{...options,value:draft[name]??options.value,maxLength:2000}));
    const verified=input("원본과 공급가·재고·직배송·재판매 및 이미지 권리를 확인했습니다.","verified",{type:"checkbox"});
    verified.prepend(verified.lastElementChild);
    verified.firstElementChild.style.width="auto";verified.firstElementChild.checked=Boolean(draft.verified);
    supply.append(verified);
    const manual=make("fieldset");
    manual.append(make("legend","직접 확인한 시장 표본"));
    const sampleList=make("div");
    const add=make("button","시장 표본 추가");add.type="button";
    add.onclick=()=>addSample({});
    manual.append(sampleList,add);
    const saveBtn=make("button","보완 자료 제출");saveBtn.type="submit";
    const returnCost=input("확인된 반품 실비 (원, 선택)","returnCost",{type:"number",value:draft.returnCost});
    const errorLine=make("p");errorLine.setAttribute("role","status");
    const settings=make("fieldset"), settingGrid=make("div");
    settingGrid.className="grid";
    const naver=candidate.channel==="네이버";
    const feeKey=naver?"grade":"category";
    const settingsFields=[
      [naver?"네이버 매출 등급":"쿠팡 상품 분류",feeKey,{choices:choices[feeKey],placeholder:"선택"}],
      ["구매자 배송비 (원)","shipping",{type:"number",required:true}],
      ["리뷰 상위 표본","top",{choices:choices.top,required:true}]
    ];
    for(const [title,name,options] of settingsFields){
      settingGrid.append(input(title,"setting-"+name,{...options,value:draft.settings?.[name]??candidate.input[name]}));
    }
    settings.append(make("legend","판매 조건 변경"),settingGrid);
    helper.append(supply,manual,settings,returnCost,saveBtn,errorLine);
    for(const sample of draft.manualSamples??[])addSample(sample);
    function addSample(sample){
      const row=make("fieldset"), grid=make("div");grid.className="grid";
      row.append(make("legend","시장 표본"),grid);
      for(const [title,name,type,required] of [
        ["상품명","title","text",true],["제조사","maker","text",false],["모델","model","text",false],["규격·구성","option","text",true],["구성 수량","quantity","number",false],
        ["판매처","seller","text",true],["상품 출처","url","url",true],["리뷰 수","reviews","number",false],["구매 가능한 상품가 (원)","price","number",true],
        ["배송비 (원)","shipping","number",true],["확인 시각 (한국시간)","time","datetime-local",true],["정상가 (원)","regularPrice","number",false],["행사가 (원)","promoPrice","number",false],["할인 조건","condition","text",false]
      ]){
        const original=sample[name]??(name==="time"?new Date(Date.now()+9*3600000).toISOString().slice(0,16):undefined);
        grid.append(input(title,"sample-"+name,{type,required,value:original,maxLength:500}));
      }
      const offer=make("label","판매가 적용 조건 ");
      const offerSelect=make("select");
      offerSelect.name="sample-offerType";
      offerSelect.append(new Option("일반 판매가","regular"),new Option("누구나 적용되는 행사가","unconditional"),new Option("회원·쿠폰 등 조건부","conditional"));
      offerSelect.value=sample.offerType??"regular";offer.append(offerSelect);grid.append(offer);
      const confirmed=input("구성과 일반배송 조건, 출처의 표시 가격을 직접 확인했습니다.","sample-confirmed",{type:"checkbox",required:true});
      confirmed.prepend(confirmed.lastElementChild);confirmed.firstElementChild.style.width="auto";confirmed.firstElementChild.checked=Boolean(sample.confirmed);
      const remove=make("button","이 표본 삭제");remove.type="button";
      remove.onclick=()=>{row.remove();remember();};
      row.append(confirmed,remove);sampleList.append(row);remember();
    }
    function valuesForSample(row){
      const data={};
      for(const control of row.querySelectorAll("[name]")){
        const name=control.name.slice(7);
        if(control.type==="checkbox")data[name]=control.checked;
        else if(control.value!=="")data[name]=control.type==="number"?Number(control.value):control.value;
      }
      return {...data,match:Boolean(data.confirmed)};
    }
    function remember(){
      const values=Object.fromEntries(fields.map(([,name])=>[name,helper.elements.namedItem(name).value]));
      const settings=Object.fromEntries(settingsFields.map(([,name])=>{
        const value=helper.elements.namedItem("setting-"+name).value;
        return [name,name===feeKey?value:Number(value)];
      }));
      notes.set(key,{...values,verified:verified.firstElementChild.checked,returnCost:returnCost.lastElementChild.value,manualSamples:[...sampleList.children].map(valuesForSample),settings});
    }
    helper.addEventListener("input",remember);
    helper.onsubmit=async event=>{
      event.preventDefault();
      remember();
      const {verified,returnCost,manualSamples,settings,...data}=notes.get(key);
      if(verified&&Object.values(data).some(value=>!value.trim())){
        errorLine.textContent="공급 원본 확인에 필요한 항목을 모두 입력하세요.";return;
      }
      const payload={mode:record.mode,candidateId:candidate.id};
      if(verified)payload.evidence={...data,verified:true};
      if(manualSamples.length)payload.manualSamples=manualSamples;
      if(returnCost!=="")payload.returnCost=Number(returnCost);
      if(Object.entries(settings).some(([name,value])=>String(value)!==String(candidate.input[name]??"")))payload.settings=settings;
      if(!payload.evidence&&!payload.manualSamples&&payload.returnCost==null&&!payload.settings){
        errorLine.textContent="보완 자료나 변경할 판매 조건을 입력하세요.";return;
      }
      saveBtn.disabled=true;
      try{
        await api(endpoint+"/"+record.id+"/supplement",payload);
        notes.delete(key);
        if(current?.id===record.id&&mode()===record.mode)await refresh(true,record.id);
      }catch(error){errorLine.textContent=error.message;}finally{saveBtn.disabled=false;}
    };
    return helper;
  }

  function show(record){
    const opened=new Set([...detail.querySelectorAll("details[open]")].map(node=>node.dataset.key));
    const main=make("div");
    main.append(make("h3","추천 상품"));
    if(record.ranking?.length){
      main.append(table(["순위","상품·옵션","마켓","승인 검토가","예상 공헌이익","경쟁강도","종합 점수"],record.ranking.map((row,index)=>{
        const candidate=typeof row==="object"&&row.input?row:record.candidates.find(candidate=>candidate.id===(row.candidateId??row.id??row));
        const result=candidate?.analysis?.result;
        return [row.rank??index+1,[candidate?.input?.name,candidate?.input?.option].filter(Boolean).join(" · "),candidate?.channel,money(result?.reference),
          money(result?.profit)+" · "+ratio(result?.margin),result?.assessment?.strength,result?.assessment?.total??"근거 부족"];
      })));
    }else main.append(make("p","추천 조건을 충족한 상품이 아직 없습니다."));
    main.append(make("h3","상품별 조사·검증"));
    for(const candidate of record.candidates??[]){
      const id=record.id+"-"+candidate.id;
      const content=make("div");
      content.append(make("p","검증 결과 "+label(candidate.validation?.status)+" · 공급가 "+money(candidate.input.cost)+" · 공급 배송비 "+money(candidate.input.freight)),sourceLink(candidate.input.source));
      if(candidate.validation?.issues?.length)content.append(issueRows(candidate.validation.issues));
      content.append(details("시장 표본과 채택 근거",sampleView(candidate),id+"-samples"));
      if(candidate.analysis)content.append(details("수익성 분석",analysisView(candidate),id+"-analysis"));
      if(["BLOCKED","FAILED"].includes(candidate.status)&&record.mode==="manual")content.append(details("확인한 자료 보완",supplementView(record,candidate),id+"-supplement"));
      if(Object.keys(candidate.notes??{}).length){
        const summary=make("ul");
        for(const [key,value] of Object.entries(candidate.notes))summary.append(make("li",role(key)+" · "+value));
        content.append(details("역할별 AI 설명",summary,id+"-notes"));
      }
      if(candidate.validation?.status==="PASS"&&candidate.validation.accepted?.length&&candidate.analysis?.result?.profit!=null){
        const use=make("button","계산서로 불러오기");use.type="button";
        use.onclick=async()=>{use.disabled=true;try{await openDraft(record,candidate);}catch(error){message(error.message);}finally{use.disabled=false;}};
        content.append(use);
      }
      main.append(details([candidate.input.name,candidate.input.option,candidate.channel,label(candidate.status)].filter(Boolean).join(" · "),content,id));
    }
    if(!record.candidates?.length)main.append(make("p","이번 회차에 선정된 조사 대상이 없습니다."));
    if(record.actuals?.length){
      main.append(make("h3","정산 실적 대조"),table(["기록일","마켓","계산서","주문행","정산 수입","예상 공헌이익","실제 공헌이익","차이"],record.actuals.map(item=>[
        item.date,item.channel,item.version,item.orderCount,money(item.settlement),money(item.forecastProfit),
        money(item.actualProfit),money(item.actualProfit==null||item.forecastProfit==null?null:item.actualProfit-item.forecastProfit)
      ])));
    }
    const events=record.events??[];
    main.append(details("에이전트 작업 및 재작업 이력 ("+events.length+"건)",table(["한국시간","담당","상품·마켓","상태","처리 내역"],events.map(event=>{
      const candidate=record.candidates?.find(item=>item.id===event.candidateId);
      const message=make("div",event.message);
      const issues=Array.isArray(event.detail)?event.detail:event.detail?.issues;
      if(issues?.some(issue=>issue?.field)){
        const list=make("ul");
        for(const issue of issues)list.append(make("li",[fieldLabels[issue.field]??issue.field,issue.reason,issue.required].filter(Boolean).join(" · ")));
        message.append(list);
      }
      return [localTime(event.created),role(event.role),candidate?[candidate.input.name,candidate.channel].join(" · "):"회차 전체",label(event.status),message];
    })),"events"));
    detail.replaceChildren(main);
    for(const node of detail.querySelectorAll("details"))node.open=opened.has(node.dataset.key);
  }

  form.elements.market.addEventListener("change",syncSettings);
  form.onsubmit=async event=>{
    event.preventDefault();
    const dataMode=mode();
    const selected=selectedChannels();
    const top=Number(form.elements.top.value);
    const settings={};
    if(selected.includes("네이버"))settings["네이버"]={grade:form.elements.naverGrade.value,shipping:Number(form.elements.naverShipping.value),top};
    if(selected.includes("쿠팡"))settings["쿠팡"]={category:form.elements.coupangCategory.value,shipping:Number(form.elements.coupangShipping.value),top};
    form.inert=true;
    try{
      const {id}=await api(endpoint,{mode:dataMode,batchId:Number(form.elements.batchId.value),channels:selected,settings});
      if(mode()===dataMode)await refresh(true,id);
    }catch(error){message(error.message);}finally{form.inert=false;}
  };
  runs.onchange=()=>refresh(false).catch(error=>message(error.message));
  el("orchestrationRefresh").onclick=()=>refresh().catch(error=>message(error.message));
  excel.onclick=async()=>{
    const record=current;
    if(!record)return;
    excel.disabled=true;
    try{
      const response=await fetch(endpoint+"/"+record.id+"/excel"+query(),{headers:{Authorization:"Bearer "+(sessionStorage.getItem("acc.admin")??"")}});
      if(!response.ok)throw Error((await response.json()).error??"Excel 파일을 받을 수 없습니다.");
      const url=URL.createObjectURL(await response.blob());
      const link=make("a");
      link.href=url;link.download="코뉴-상품분석-"+record.id+".xlsx";link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){message(error.message);}finally{excel.disabled=!current;}
  };

  function resetMode(){
    if(!enabled)return;
    clearTimeout(timer);
    ++ticket;
    current=null;detail.replaceChildren();runs.replaceChildren();savedView="";excel.disabled=true;
    const previousMode=mode();
    form.elements.naverGrade.value=previousMode==="fixture"?"일반":"";
    form.elements.coupangCategory.value=previousMode==="fixture"?choices.category[0]:"";
    form.elements.naverShipping.value="0";
    form.elements.coupangShipping.value="0";
    syncSettings();
    form.querySelector("button[type=submit]").disabled=true;
    Promise.all([loadBatches(),refresh()]).catch(error=>message(error.message));
  }
  el("mode").addEventListener("change",resetMode);
  window.addEventListener("sourcing-history-changed",()=>{if(enabled)loadBatches().catch(error=>message(error.message));});
  return {enable(){enabled=true;panel.hidden=false;el("orchestrationNav").hidden=false;resetMode();}};
}
