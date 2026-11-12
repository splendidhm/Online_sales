// Open Props의 여백 규격 일부를 상품 영역에 한정해 사용한다.
const detailStyles = `/*! Open Props | MIT License | Copyright (c) 2021 Adam Argyle
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
.product-sheet{--size-2:.5rem;--size-3:1rem;--size-fluid-4:clamp(2rem,4vw,3rem);margin:auto;max-width:54rem;background:#fffdf8;color:#232f29;font:16px/1.75 "Malgun Gothic",sans-serif;word-break:keep-all;overflow-wrap:anywhere;white-space:normal}
.product-sheet *{box-sizing:border-box}
.product-sheet .cover{background:#263e36;color:#fffdf8;padding:var(--size-fluid-4) 7%}
.product-sheet h1{margin:0 0 var(--size-3);max-width:22em;font:600 clamp(1.65rem,4vw,3rem)/1.3 Georgia,"Batang",serif;letter-spacing:-.04em;color:inherit}
.product-sheet .amount{font-size:1.4em;font-weight:700}.product-sheet .delivery{display:inline-block;margin-left:var(--size-3);color:#dce9df}
.product-sheet .sample{margin:0 0 var(--size-3);color:#dce9df;font-size:.85rem}
.product-sheet img{display:block;width:100%;height:auto}
.product-sheet .copy{padding:var(--size-fluid-4) 7%}
.product-sheet h2{margin:0 0 var(--size-2);font:700 1.1rem/1.5 "Malgun Gothic",sans-serif;color:#28483a}
.product-sheet p,.product-sheet dd{margin:0;white-space:pre-wrap}
.product-sheet .block+.block{border-top:1px solid #d8ddd2;margin-top:var(--size-fluid-4);padding-top:var(--size-3)}
.product-sheet dl{margin:0}.product-sheet dl div{display:grid;grid-template-columns:minmax(4em,22%) 1fr;gap:var(--size-2);padding:.55rem 0}.product-sheet dt{color:#516054}
`;

function detailEscape(value){
  const entities={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};
  return String(value??"").replace(/[&<>"']/g,char=>entities[char]);
}

function detailMarkup(state,draft=state.draft){
  const safe=detailEscape;
  const money=value=>value==null||value===""||!Number.isFinite(Number(value))?"미확인":Number(value).toLocaleString("ko-KR")+"원";
  const row=(name,value)=>`<div><dt>${name}</dt><dd>${safe(value||"미확인")}</dd></div>`;
  const block=(title,body)=>`<div class="block"><h2>${title}</h2>${body}</div>`;
  const photo=/^data:image\/(?:png|jpeg);base64,[a-z0-9+/]+=*$/i.test(draft.image)
    ? `<img src="${draft.image}" alt="${safe(draft.title)}">`:"";
  const sample=state.mode==="fixture"?'<p class="sample">연습 상품</p>':"";
  return `<article class="product-sheet"><div class="cover">${sample}<h1>${safe(draft.title)}</h1><strong class="amount">${money(state.price)}</strong><span class="delivery">배송비 ${money(state.shipping)}</span></div>${photo}<div class="copy">`+
    block("상품 소개",`<p>${safe(draft.body)}</p>`)+
    block("상품 정보","<dl>"+row("구성",state.option)+row("원산지",draft.origin)+row("상품정보고시",draft.disclosure)+"</dl>")+
    block("배송·반품 안내",`<p>${safe(draft.returns)}</p>`)+"</div></article>";
}

function detailDocument(state){
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${detailEscape(state.draft.title)}</title><style>body{margin:0;background:#ebece6}${detailStyles}</style></head><body>${detailMarkup(state)}</body></html>`;
}
if(typeof module!=="undefined")module.exports={detailDocument,detailMarkup};

function detailEditor(api){
  const style=document.createElement("style");style.textContent=detailStyles;document.head.append(style);
  const panel=el("studio");
  const labels={title:"상품명",body:"상세 설명",source:"공급 정보 출처",origin:"원산지",disclosure:"품목별 상품정보고시",returns:"배송·반품 안내",rights:"이미지 사용 근거 (채널·허가 문서)",imageText:"사진 속 문구 (없으면 빈칸)"};
  const fields={};
  let current=null, draft=null, generation=0;
  for(const [key,title] of Object.entries(labels)){
    const label=document.createElement("label"),field=document.createElement("textarea");
    label.textContent=title;label.append(field);el("studioFields").append(label);fields[key]=field;
    field.oninput=()=>{draft[key]=field.value;render();};
  }
  function render(){
    el("studioPreview").innerHTML=detailMarkup(current,draft);
    const dirty=JSON.stringify(current.draft)!==JSON.stringify(draft);
    el("studioApprove").disabled=dirty||!current.id||current.approved||current.issues.length>0;
    el("studioExport").disabled=dirty||!current.approved;
    el("studioIssues").replaceChildren();
    if(!dirty)for(const issue of current.issues){
      const li=document.createElement("li");li.textContent=(labels[issue.field]??"사진")+" · "+issue.message;el("studioIssues").append(li);
    }
    el("studioStatus").textContent=dirty?"수정 중 · 저장 후 다시 검수합니다.":current.approved?"2차 승인 완료":current.issues.length?"보완 "+current.issues.length+"건":"대표자 최종 검수 대기";
  }
  function display(state){
    current=state;draft=structuredClone(state.draft);
    for(const [key,field] of Object.entries(fields))field.value=draft[key];
    el("studioChecked").checked=draft.imageReviewed;el("studioFile").value="";
    el("studioMeta").textContent=[state.mode==="fixture"?"연습":"실상품",state.channel,"계산서 "+state.version,"게시본 "+(state.id||"초안")].join(" · ");
    el("studioWrite").hidden=!state.ai;panel.hidden=false;render();
  }
  el("studioChecked").onchange=e=>{draft.imageReviewed=e.target.checked;render();};
  el("studioFile").onchange=e=>{
    const file=e.target.files[0];if(!file)return;
    if(file.size>2097152){el("studioStatus").textContent="2MB 이하의 사진을 선택하세요.";return;}
    const target=draft,reader=new FileReader();
    reader.onload=()=>{if(target!==draft)return;draft.image=reader.result;draft.imageReviewed=false;el("studioChecked").checked=false;render();};
    reader.readAsDataURL(file);
  };
  async function act(action){
    const ticket=++generation;
    panel.inert=true;
    try{
      const result=await api("/api/studio",{action,version:current.version,base:current.id,draft:["write","save"].includes(action)?draft:undefined});
      if(ticket!==generation)return;
      if(action==="write"){
        for(const key of ["title","body"]){draft[key]=result[key];fields[key].value=result[key];}
        render();return;
      }
      display(result);
      if(action==="export"){
        const html=detailDocument(result);
        const url=URL.createObjectURL(new Blob([html],{type:"text/html;charset=utf-8"}));
        const a=document.createElement("a");a.href=url;a.download=result.channel+"-"+result.version+"-"+result.id+".html";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }
    }catch(error){el("studioStatus").textContent=error.message;}finally{panel.inert=false;}
  }
  el("studioSave").onclick=()=>act("save");el("studioApprove").onclick=()=>act("approve");el("studioExport").onclick=()=>act("export");
  el("studioWrite").onclick=()=>act("write");
  for(const key of ["mode","channel"])el(key).addEventListener("change",()=>{generation++;panel.hidden=true;});
  return async version=>{
    const ticket=++generation;
    const result=await api("/api/studio",{action:"open",version});
    if(ticket===generation){display(result);panel.scrollIntoView();}
  };
}
