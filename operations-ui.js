"use strict";
function operationsPanel(api){
  const root=el("opsBody"),notice=el("opsNotice");
  const stageNames={ordered:"주문 접수",purchased:"공급처 발주",shipped:"출고",delivered:"배송 완료",returned:"반품 완료",cancelled:"취소 완료"};
  const eventNames={fixture_submit:"연습 등록",manual_submit:"수동 등록",fixture_change:"연습 마켓 값 변경",verified:"판매 조건 일치",mismatch:"가격 불일치",failed:"반려",pending:"확인 대기",paused:"판매 보류",order:"주문 기록",settle:"정산 대조",...stageNames};
  const kst=value=>new Date(value.replace(" ","T")+"Z").toLocaleString("ko-KR",{timeZone:"Asia/Seoul"});
  let ticket=0;
  let results=[];
  el("opsFilter").onchange=()=>{
    for(const card of root.querySelectorAll("[data-state]"))card.hidden=Boolean(el("opsFilter").value)&&card.dataset.state!==el("opsFilter").value;
  };
  el("downloadResults").onclick=()=>{
    const fields=["자료 종류","상품명","구성","마켓","공급단가(원)","승인가(원)","등록가(원)","예상 이익률(%)","경쟁강도","등록 결과","사유","등록번호","확인 시각(한국)"];
    const mode=el("mode").value==="fixture"?"연습":"실상품";
    const rows=results.map(r=>[mode,r.name,r.expected.option,r.channel,Number(r.cost),r.expected.price,r.observed?.price,r.margin.toFixed(2),r.strength,r.label,r.reason,r.external,kst(r.updated)]);
    const cell=value=>{
      let s=String(value??"");
      if(typeof value==="string"&&/^[\s]*[=+@-]/.test(s))s="'"+s;
      return '"'+s.replaceAll('"','""')+'"';
    };
    const csv=[fields,...rows].map(row=>row.map(cell).join(",")).join("\r\n");
    const url=URL.createObjectURL(new Blob(["\ufeff",csv],{type:"text/csv;charset=utf-8"}));
    const a=node("a");a.href=url;a.download=mode+"-마켓등록결과.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const importForm=el("importForm");
  importForm.elements.day.value=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  const sourceLabels={PAYED:"결제 완료",PAYMENT_WAITING:"결제 대기",PURCHASE_DECIDED:"구매 확정",DELIVERED:"배송 완료",CANCELED:"취소",RETURNED:"반품",ACCEPT:"결제 완료",INSTRUCT:"상품 준비",DEPARTURE:"출고 지시",DELIVERING:"배송 중",FINAL_DELIVERY:"배송 완료",NONE_TRACKING:"직접 배송",SALE:"매출",REFUND:"환불",NORMAL_SETTLE_ORIGINAL:"일반 정산",NORMAL_SETTLE_AFTER_CANCEL:"정산 후 취소"};
  importForm.oninput=()=>el("importRows").replaceChildren();
  importForm.onsubmit=async event=>{
    event.preventDefault();const t=ticket,container=el("importRows"),options=Object.fromEntries(new FormData(importForm));
    importForm.inert=true;container.textContent="조회 중";
    try{
      const result=await api("/api/market-import",{...options,mode:"manual",action:event.submitter?.value??"read"});
      if(t!==ticket)return;
      container.replaceChildren(node("p",result.updated?kst(result.updated)+" · "+result.records.length+"행":"저장한 조회 결과가 없습니다."));
      for(const r of result.records){
        const amount=r.amount==null?"금액 미확인":won(Number(r.amount));
        const line=[r.ref,r.name,sourceLabels[r.status]??("원문 상태 "+(r.status??"미확인")),amount,r.order?"내부 주문 연결":"내부 주문 대조 필요"];
        container.append(node("p",line.filter(Boolean).join(" · ")));
        if(options.kind==="orders"&&r.listing&&!r.order){
          form(container,"이 주문을 운영 장부에 반영",[["paid","배송·할인 반영 실제 결제액"],["cost","실제 총 매입액"],["freight","공급 배송비"]],async values=>{
            try{
              await api("/api/operations",{mode:"manual",action:"order",listing:r.listing,ref:r.ref,qty:r.qty,...values});
              await refresh();importForm.requestSubmit(importForm.querySelector('[value="read"]'));
            }catch(e){notice.textContent=e.message;}
          });
        }else if(options.kind==="settlements"&&r.order){
          const received=r.order.received;
          container.append(node("small",received==null?"운영 장부 정산 대기":"장부 순정산 "+won(received)+" · 이 원장 행과의 차이 "+(r.amount==null?"미확인":won(Number(r.amount)-received))));
        }
      }
    }catch(e){if(t===ticket)container.textContent=e.message;}finally{importForm.inert=false;}
  };
  function node(tag,text){
    const n=document.createElement(tag);if(text!=null)n.textContent=text;return n;
  }
  function form(parent,title,spec,submit){
    const details=node("details"),f=node("form"),grid=node("div");grid.className="grid";
    for(const [name,label,initial,options] of spec){
      const l=node("label",label),input=node(options?"select":"input");
      if(options)for(const [v,t] of Object.entries(options))input.append(new Option(t,v));
      input.name=name;input.value=initial??"";input.required=true;l.append(input);grid.append(l);
    }
    details.append(node("summary",title),f);f.append(grid,node("button",title));parent.append(details);
    if(f.elements.sale){
      f.elements.sale.onchange=()=>{
        for(const input of grid.querySelectorAll("input"))input.disabled=f.elements.sale.value!=="selling";
      };
    }
    f.onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(f));f.inert=true;try{await submit(data);}finally{f.inert=false;}};
  }
  async function refresh(){
    const mode=el("mode").value,t=++ticket;
    results=[];el("downloadResults").disabled=true;
    el("marketImport").hidden=mode!=="manual";el("importRows").replaceChildren();
    root.replaceChildren();notice.textContent="운영 기록 조회 중";
    try{
      const {items,orders,events,supply,weekly,returns,approvals}=await api("/api/operations",{action:"report",mode});
      if(t!==ticket)return;
      results=items;el("downloadResults").disabled=!items.length;
      const send=async data=>{
        if(el("mode").value!==mode)return;
        try{await api("/api/operations",{mode,...data});if(el("mode").value===mode)await refresh();}
        catch(e){notice.textContent=e.message;}
      };
      notice.textContent=[mode==="fixture"?"연습 마켓":"실상품 운영 기록",...Object.entries({verified:"성공",failed:"실패",pending:"대기",mismatch:"가격 불일치",paused:"보류"}).map(([s,label])=>label+" "+items.filter(x=>x.status===s).length+"건")].join(" · ");
      if(!items.length)root.append(node("p","판매가능수량을 입력한 상세페이지를 승인한 다음 등록하면 이곳에 표시됩니다."));
      for(const x of items){
        const card=node("section"),p=x.expected;
        card.dataset.state=x.status;card.hidden=Boolean(el("opsFilter").value)&&el("opsFilter").value!==x.status;
        card.append(node("h3",x.name+" · "+x.channel),node("p",p.option+" · 등록번호 "+x.external+" · "+x.label),
          node("p","매입 "+won(Number(x.cost))+" / 승인 "+won(p.price)+" / 등록 "+(x.observed?.price!=null?won(x.observed.price):"미확인")+" / 예상 이익률 "+x.margin.toFixed(1)+"% / 경쟁강도 "+x.strength),
          node("p",x.reason+" · "+kst(x.updated)));
        if(x.site_external)card.append(node("p","G마켓 사이트 상품번호 "+x.site_external));
        const check=supply.find(check=>check.listing===x.id);
        if(check){
          const warnings=[];
          if(check.cost!==Number(x.cost))warnings.push("매입가 변경 · 계산서 재검토");
          if(check.stock<p.stock)warnings.push(check.stock?"공급 재고 부족":"품절");
          card.append(node("p","공급 재고 "+check.stock+"개 · 현재 매입가 "+won(check.cost)+" · "+(warnings.join(" / ")||"공급 조건 일치")+" · "+kst(check.created)));
        }
        form(card,"공급 조건 점검",[["cost","현재 매입가"],["stock","공급 재고"]],data=>send({...data,listing:x.id,action:"supply"}));
        if(x.canReadSupply){
          const b=node("button","도매매 공급가·재고 재조회");b.onclick=()=>send({listing:x.id,action:"readSupply"});card.append(b);
        }
        const state={selling:"판매 중",pending:"심사 중",rejected:"반려",stopped:"판매 중지"};
        const observed=x.observed??{};
        const obs=(key)=>mode==="fixture"?observed[key]??p[key]:"";
        form(card,mode==="fixture"?"연습 마켓 값 변경":"판매자센터 조회값 기록",[["sale","판매 상태","selling",state],["option","조회 옵션",obs("option")],["price","상품가",obs("price")],["extra","옵션 추가금",obs("extra")],["discount","판매자 할인",obs("discount")],["shipping","배송비",obs("shipping")],["stock","판매가능수량",obs("stock")]],data=>send({...data,listing:x.id,action:mode==="fixture"?"simulate":"verify"}));
        if(mode==="fixture"){
          const b=node("button","마켓 재조회");b.onclick=()=>send({action:"verify",listing:x.id});card.append(b);
        }else{
          const b=node("button","마켓 API 재조회");card.append(b);
          b.onclick=async()=>{
            b.disabled=true;
            try{await api("/api/market-read",{version:x.version,revision:x.revision});await refresh();}
            catch(e){await refresh();notice.textContent=e.message;}
          };
        }
        form(card,"주문행 입력",[["ref","마켓 주문행 번호"],["qty","수량",1],["paid","배송비 포함 총 결제액"],["cost","이 주문의 총 매입액"],["freight","이 주문의 공급 배송비"]],data=>send({...data,listing:x.id,action:"order"}));
        root.append(card);
      }
      root.append(node("h3","주문·정산"));
      let net=0,settled=0;
      for(const o of orders){
        const box=node("details");
        box.append(node("summary",o.channel+" "+o.ref+" · "+stageNames[o.stage]));
        box.append(node("p","수량 "+o.qty+" · 결제 "+won(o.paid)+" · 매입 "+won(o.cost)+" · 배송비 "+won(o.freight)));
        const sendOrder=data=>send({...data,listing:o.listing,order:o.id});
        const refunds=returns.filter(r=>r.order_id===o.id);
        for(const r of refunds)box.append(node("p","반품 "+r.ref+" · "+r.qty+"개 · 공급처 환급 "+won(r.recovery)+" · 회수 등 실비 "+won(r.expense)));
        if(["shipped","delivered","returned"].includes(o.stage)&&refunds.reduce((n,r)=>n+r.qty,0)<o.qty){
          form(box,"반품 내역 기록",[["ref","반품행 번호"],["qty","반품 수량"],["recovery","공급처에서 환급받은 금액"],["expense","순정산액 외 반품 실비"]],data=>sendOrder({...data,action:"return"}));
        }
        const next={ordered:["purchased","cancelled"],purchased:["shipped","cancelled"],shipped:["delivered","returned"],delivered:["returned"]};
        for(const stage of next[o.stage]??[]){
          const b=node("button",stageNames[stage]);b.onclick=()=>sendOrder({action:"advance",stage});box.append(b);
        }
        if(["cancelled","delivered","returned"].includes(o.stage)){
          form(box,"정산 기록",[["received","수수료·환불 반영 후 순정산액",o.received],["loss","정산 외 추가 실비",o.loss]],data=>sendOrder({...data,action:"settle"}));
        }
        if(o.received!=null){
          const profit=o.received-o.cost-o.freight-o.loss+refunds.reduce((n,r)=>n+r.recovery-r.expense,0);net+=profit;settled++;
          box.append(node("p","실현 공헌이익 "+won(profit)+" · 단건 예상이익 × 수량 대비 "+won(profit-o.estimated)));
        }
        root.append(box);
      }
      root.append(node("p","정산 완료 "+settled+"건 · 실현 공헌이익 합계 "+won(net)+" · 정산 대기 "+(orders.length-settled)+"건"));
      root.append(node("p","최근 7일 정산 "+weekly.count+"건 · 실현 공헌이익 "+won(weekly.profit??0)));
      const audit=node("details");audit.append(node("summary","최근 운영 이력"));
      for(const e of events)audit.append(node("p",kst(e.created)+" · 등록 건 "+e.listing+" · "+({supply_unavailable:"공급처 자동 조회 실패",read_unavailable:"마켓 자동 조회 실패",return_line:"반품 내역 기록",supply:"공급 조건 확인",live_submit:"실상품 등록 요청"}[e.action]??eventNames[e.action])));
      root.append(audit);
      const decisions=node("details");decisions.append(node("summary","상품·게시 승인 이력"));
      for(const d of approvals)decisions.append(node("p",kst(d.created)+" · "+d.channel+" 계산서 "+d.version+" · "+d.gate+"차 "+({approve:"승인",reject:"제외",revise:"수정 요청"}[d.action]??d.action)));
      root.append(decisions);
    }catch(e){if(t===ticket)notice.textContent=e.message;}
  }
  el("mode").addEventListener("change",refresh);window.addEventListener("operations-changed",refresh);refresh();
}
