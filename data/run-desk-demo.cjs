const {createApp}=require("../server");
const {randomBytes}=require("node:crypto");
const fs=require("node:fs"),path=require("node:path");
const token=randomBytes(32).toString("hex");
const server=createApp(path.join(__dirname,"candidates.sqlite"),token);
server.listen(0,"127.0.0.1",async()=>{
  async function api(route,body){
    const response=await fetch("http://127.0.0.1:"+server.address().port+"/api/"+route,{method:body?"POST":"GET",headers:{Authorization:"Bearer "+token},body:body&&JSON.stringify(body)});
    const result=await response.json();if(!response.ok)throw Error(result.error);return result;
  }
  try{
    const input={name:"트리오 데스크 펜꽂이",maker:"연습문구",model:"TRIO-03",option:"아이보리 3칸 1개",source:"https://fixture.invalid/products/trio-demo",keywords:"펜꽂이 3칸",grade:"일반",cost:4800,freight:3000,shipping:0,top:5};
    const samples=[10900,11500,11900,12500,12900].map((price,i)=>({...input,title:input.name,url:"https://fixture.invalid/market/trio-"+i,seller:"모의 판매처 "+(i+1),price,shipping:0,time:"2026-11-12T15:00",reviews:[63,28,140,87,45][i],match:true}));
    const rows=await api("candidates?mode=fixture");
    const old=rows.find(r=>r.input.source===input.source && r.channel==="네이버");
    const {id}=await api("candidates",{mode:"fixture",channel:"네이버",input,samples,checks:true,base:old?.id??0});
    await api("decision",{id,choice:"진행"});
    const open=await api("studio",{version:id,action:"open"});
    const draft={...open.draft,stock:"20",title:"트리오 데스크 펜꽂이 · 아이보리 3칸 1개",body:"펜, 형광펜, 가위를 한 칸씩 나눠 꽂아 보세요. 두 개의 칸막이가 긴 직사각형 수납공간을 세 구역으로 나눕니다.\n\n구성은 아이보리 3칸 1개입니다. 필기구는 포함되지 않습니다.",origin:"연습용 가상 사양 · 대한민국",disclosure:"모델 TRIO-03 / 색상 아이보리 / 구성 펜꽂이 1개. 시연용 가상 상품입니다.",returns:"연습 조건 · 기본 배송비 0원. 실제 주문 및 반품 접수 대상이 아닙니다.",rights:"연습 페이지용으로 직접 생성한 AI 제품 목업",imageText:"",imageReviewed:true,image:"data:image/jpeg;base64,"+fs.readFileSync(path.join(__dirname,"desk-trio-demo.jpg")).toString("base64")};
    await api("studio",{version:id,base:open.id,action:"save",draft});
    const page=await api("studio",{version:id,action:"open"});
    if(page.issues.length||page.draft.image!==draft.image||page.approved)throw Error("저장된 초안 상태를 확인하세요.");
    const html=require("../detail-editor").detailDocument(page);
    fs.writeFileSync(path.join(__dirname,"desk-trio-preview.html"),html);
    const saved=(await api("candidates?mode=fixture")).find(r=>r.id===id);
    console.log({candidate:id,revision:page.id,issues:page.issues.length,price:page.price,profit:saved.result.profit,margin:saved.result.margin});
  }catch(e){console.error(e.message);process.exitCode=1;}finally{server.close();}
});
