const http = require("node:http");
const {DatabaseSync} = require("node:sqlite");
const {randomBytes} = require("node:crypto");
const {readFileSync, mkdirSync} = require("node:fs");
const path = require("node:path");
const {research}=require("./research");
const {configured,contentAI}=require("./content-ai");
const {evaluate} = require("./market");
const {mockProducts,screen} = require("./sourcing");

function fail(message, status = 400) { throw Object.assign(Error(message), {status}); }
function required(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(label+" 입력이 필요합니다.");
  return value.trim();
}
function link(value) {
  let url;
  try { url = new URL(value); } catch { fail("출처 링크를 확인하세요."); }
  if (!["http:","https:"].includes(url.protocol)) fail("웹 주소를 입력하세요.");
  url.hash = "";
  return url.href;
}

function createApp(filename, token) {
  const db = new DatabaseSync(filename);
  const studio=require("./studio").studioStore(db);
  const ops=require("./operations").operations(db,studio);
  db.exec("CREATE TABLE IF NOT EXISTS sourcing_batches(id INTEGER PRIMARY KEY, total INTEGER NOT NULL, snapshot TEXT NOT NULL, created TEXT DEFAULT CURRENT_TIMESTAMP)");
  if(!db.prepare("PRAGMA table_info(sourcing_batches)").all().some(c=>c.name==="mode"))db.exec("ALTER TABLE sourcing_batches ADD COLUMN mode TEXT NOT NULL DEFAULT 'fixture'");
  db.exec(`CREATE TABLE IF NOT EXISTS versions(
    id INTEGER PRIMARY KEY, identity TEXT NOT NULL, channel TEXT NOT NULL, mode TEXT NOT NULL,
    body TEXT NOT NULL, created TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS by_product ON versions(mode,identity,channel,id);
    CREATE TABLE IF NOT EXISTS decisions(version INTEGER PRIMARY KEY, choice TEXT NOT NULL,
    created TEXT DEFAULT CURRENT_TIMESTAMP);`);
  const latest = db.prepare("SELECT * FROM versions WHERE mode=? AND identity=? AND channel=? ORDER BY id DESC LIMIT 1");
  function list(mode){
    return db.prepare(`SELECT v.*,d.choice,d.created AS decided FROM versions v LEFT JOIN decisions d ON d.version=v.id
      WHERE v.mode=? AND v.id IN (SELECT MAX(id) FROM versions GROUP BY mode,identity,channel)
      ORDER BY v.id DESC`).all(mode).map(({body,...row})=>({...row,...JSON.parse(body)}));
  }
  function command(route,data,aiReview){
    if(route==="/api/demo"){
      if(data.mode!=="fixture")fail("연습 자료를 선택하세요.");
      const input={name:"트리오 데스크 펜꽂이",maker:"연습문구",model:"TRIO-03",option:"아이보리 3칸 1개",source:"https://fixture.invalid/products/trio-demo",keywords:"펜꽂이 3칸",grade:"일반",cost:4800,freight:3000,shipping:0,top:5};
      const prior=latest.get("fixture",JSON.stringify([input.source,input.option]),"네이버");
      const samples=[10900,11500,11900,12500,12900].map((price,i)=>({title:input.name,maker:input.maker,model:input.model,option:input.option,url:"https://fixture.invalid/market/trio-"+i,seller:"연습 판매처 "+(i+1),price,shipping:0,time:"2026-11-12T15:00",reviews:20+i,match:true}));
      const id=prior?.id??command("/api/candidates",{mode:"fixture",channel:"네이버",input,samples,checks:true,base:0}).id;
      const decision=db.prepare("SELECT choice FROM decisions WHERE version=?").get(id);
      if(decision&&decision.choice!=="진행")fail("이 연습 상품은 보류·제외 상태입니다. 후보 목록에서 재검토용 계산서를 저장하세요.");
      if(!decision)command("/api/decision",{id,choice:"진행"});
      const state=studio({action:"open",version:id});
      if(!state.id)studio({action:"save",base:0,version:id,draft:{...state.draft,stock:"20",body:"필기구를 세 칸으로 나누어 담는 아이보리 펜꽂이입니다. 필기구는 구성에 포함되지 않습니다.",origin:"대한민국 (연습 사양)",disclosure:"TRIO-03 · 아이보리 3칸 1개 · 연습 상품",returns:"연습 상품 · 배송비 0원",rights:"직접 생성한 연습용 이미지",imageReviewed:true,image:"data:image/jpeg;base64,"+readFileSync(path.join(__dirname,"data","desk-trio-demo.jpg")).toString("base64")}});
      return {id};
    }
    if(route==="/api/operations")return ops(data);
    if(route==="/api/studio")return {...studio(data,aiReview),ai:configured()};
    if(route==="/api/batches"){
      const mode=data.mode??"fixture";
      if(!["manual","fixture"].includes(mode))fail("자료 종류를 확인하세요.");
      const products=mode==="manual"?require("./sourcing").supplierProducts(data.items):mockProducts(data.limit);
      const snapshot=screen(products);
      const record=db.prepare("INSERT INTO sourcing_batches(mode,total,snapshot) VALUES(?,?,?)").run(mode,products.length,JSON.stringify(snapshot));
      return {id:Number(record.lastInsertRowid),...snapshot};
    }
    if(route==="/api/decision"){
      const row=db.prepare("SELECT * FROM versions WHERE id=?").get(data.id);
      if(!row || latest.get(row.mode,row.identity,row.channel).id!==row.id) fail("새 버전을 다시 확인하세요.",409);
      const prior=db.prepare("SELECT choice FROM decisions WHERE version=?").get(row.id);
      if(prior && prior.choice!==data.choice) fail("이미 결정된 버전입니다. 재검토용 버전을 저장하세요.",409);
      if(!["진행","보류","제외"].includes(data.choice)) fail("결정을 선택하세요.");
      const {result,checks}=JSON.parse(row.body);
      if(data.choice==="진행" && (!checks || result.version!==(row.channel==="G마켓"?3:2) || result.profit===null)) fail("시장 가격·수수료와 공급 조건을 확인한 최신 계산서를 저장하세요.");
      db.prepare("INSERT OR IGNORE INTO decisions(version,choice) VALUES(?,?)").run(row.id,data.choice);
      return {id:row.id};
    }
    const {input,samples,mode,channel,checks}=data;
    if(!["fixture","manual"].includes(mode)||!["네이버","쿠팡","G마켓"].includes(channel)||!input||!Array.isArray(samples)||typeof checks!=="boolean") fail("계산서 형식을 확인하세요.");
    required(input.name,"상품명");
    const option=required(input.option,"옵션");
    const source=mode==="fixture" && !input.source ? input.name.trim() : link(input.source);
    for(const s of samples){
      required(s.seller,"판매자"); required(s.option,"표본 규격"); s.url=link(s.url);
      if(typeof s.match!=="boolean" || !Number.isFinite(Date.parse(s.time+"+09:00"))) fail("표본 확인 정보를 확인하세요.");
    }
    const result=evaluate(input,samples,channel);
    const identity=JSON.stringify([source,option]);
    const previous=latest.get(mode,identity,channel);
    const snapshot={input,samples,checks,result};
    if(data.batchId!=null){
      const batch=db.prepare("SELECT snapshot FROM sourcing_batches WHERE id=? AND mode=?").get(data.batchId,mode);
      const product=batch&&JSON.parse(batch.snapshot).rows.find(row=>row.source===source&&(row.option===option||!row.option));
      if(!product||!(product.status==="조사 대상"||mode==="manual"&&product.status==="보완"&&checks))fail("회차 상품과 보완 조건을 확인하세요.");
      if(product.evidence)snapshot.evidence=product.evidence;
      snapshot.batchId=data.batchId;
    }
    if(mode==="manual" && new URL(source).hostname==="fixture.invalid") fail("모의 공급 상품은 연습 계산서에서 사용하세요.");
    const body=JSON.stringify(snapshot);
    if(previous?.body===body && !data.review) return {id:previous.id};
    if((previous?.id??0)!==data.base) fail("같은 상품·채널의 최신 계산서를 열어 수정하세요.",409);
    if(!previous && !snapshot.batchId){
      const manualRows=list(mode).filter(row=>!row.batchId);
      if(!manualRows.some(row=>row.identity===identity) && new Set(manualRows.map(row=>row.identity)).size>=10) fail("직접 입력하는 시범 목록은 후보 10개까지 저장합니다.");
    }
    const saved=db.prepare("INSERT INTO versions(identity,channel,mode,body) VALUES(?,?,?,?)").run(identity,channel,mode,body);
    return {id:Number(saved.lastInsertRowid)};
  }
  const files={"/":"index.html","/index.html":"index.html","/worksheet.js":"worksheet.js","/market.js":"market.js","/candidates.js":"candidates.js"};
  files["/detail-editor.js"]="detail-editor.js";
  files["/operations-ui.js"]="operations-ui.js";
  const naver=require("./naver-provider").naverProvider();
  const coupang=require("./coupang-provider").coupangProvider();
  const {gmarketProvider,esmReady}=require("./gmarket-provider");
  const markets={"네이버":naver,"쿠팡":coupang,"G마켓":gmarketProvider()};
  function connected(channel){
    if(channel==="네이버")return Boolean(process.env.ACC_NAVER_ACCESS_TOKEN);
    if(channel==="쿠팡")return Boolean(process.env.ACC_COUPANG_SECRET&&process.env.ACC_COUPANG_KEY&&process.env.ACC_COUPANG_VENDOR);
    return channel==="G마켓"&&esmReady();
  }
  db.exec("CREATE TABLE IF NOT EXISTS marketplace_imports(channel TEXT,day TEXT,kind TEXT,records TEXT NOT NULL,updated TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(channel,day,kind))");
  const importsInFlight=new Set();
  async function marketplaceImport(data){
    const {mode,channel,day,kind}=data;
    if(mode!=="manual"||!["네이버","쿠팡"].includes(channel)||!["orders","settlements"].includes(kind))fail("실상품 마켓과 조회 항목을 선택하세요.");
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||new Date(day+"T00:00:00Z").toISOString().slice(0,10)!==day)fail("조회 날짜를 확인하세요.");
    const key=[channel,day,kind].join("|");
    if(data.action==="sync"){
      if(importsInFlight.has(key))fail("같은 내역을 조회 중입니다.",409);
      importsInFlight.add(key);
      try{
        const records=await (channel==="네이버"?naver:coupang).records(day,kind);
        db.prepare("INSERT INTO marketplace_imports(channel,day,kind,records) VALUES(?,?,?,?) ON CONFLICT(channel,day,kind) DO UPDATE SET records=excluded.records,updated=CURRENT_TIMESTAMP").run(channel,day,kind,JSON.stringify(records));
      }finally{importsInFlight.delete(key);}
    }else if(data.action!=="read")fail("조회 방식을 확인하세요.");
    const saved=db.prepare("SELECT updated,records FROM marketplace_imports WHERE channel=? AND day=? AND kind=?").get(channel,day,kind);
    const lines=db.prepare("SELECT o.ref,o.received,l.id FROM order_lines o JOIN listings l ON l.id=o.listing JOIN versions v ON v.id=l.version WHERE v.mode='manual' AND v.channel=?").all(channel);
    const orders=new Map(lines.map(r=>[r.ref,r]));
    const offers=db.prepare("SELECT MAX(l.id) AS listing,v.id FROM listings l JOIN versions v ON v.id=l.version WHERE v.mode='manual' AND v.channel=? GROUP BY v.id").all(channel);
    const bySku=new Map(offers.map(r=>["ACC-"+r.id,r.listing]));
    const aliases=new Map();
    if(channel==="쿠팡"&&kind==="settlements"){
      for(const snapshot of db.prepare("SELECT records FROM marketplace_imports WHERE channel=? AND kind='orders'").iterate(channel)){
        for(const row of JSON.parse(snapshot.records)){
          if(!row.settlementRef)continue;
          const refs=aliases.get(row.settlementRef)??new Set();refs.add(row.ref);aliases.set(row.settlementRef,refs);
        }
      }
    }
    const records=JSON.parse(saved?.records??"[]").map(row=>{
      const refs=aliases.get(row.ref);
      const ref=channel==="쿠팡"&&kind==="settlements"?(refs?.size===1?[...refs][0]:null):row.ref;
      return {...row,order:orders.get(ref)??null,listing:bySku.get(row.sku)??null};
    });
    return {records,updated:saved?.updated};
  }
  async function marketAction(data,submit){
    const readPage=()=>studio({action:"export",version:data.version,base:data.revision});
    const historical=!submit&&db.prepare("SELECT v.mode,v.channel,l.external,r.content,l.expected FROM listings l JOIN versions v ON v.id=l.version JOIN detail_revisions r ON r.id=l.revision WHERE l.version=? AND l.revision=?").get(data.version,data.revision);
    const page=historical?{...JSON.parse(historical.expected),version:data.version,id:data.revision,mode:historical.mode,channel:historical.channel,draft:JSON.parse(historical.content)}:readPage();
    if(page.mode!=="manual"||!Object.hasOwn(markets,page.channel))fail("지원하는 마켓의 실상품 승인본을 선택하세요.");
    const provider=markets[page.channel];
    let entry=db.prepare("SELECT * FROM listings WHERE revision=?").get(page.id);
    if(!submit&&!entry)fail("먼저 원상품번호를 기록하세요.");
    if(submit&&(!entry||entry.status==="failed"&&entry.external.startsWith("PENDING-"))){
      if(!connected(page.channel)||!page.draft.marketProfile||!Number(page.draft.stock))fail("승인 재고·마켓 설정과 서버 인증 설정을 확인하세요.");
      const prior=db.prepare("SELECT l.id FROM listings l JOIN versions v ON v.id=l.version JOIN versions cur ON cur.id=? WHERE cur.identity=v.identity AND cur.mode=v.mode AND cur.channel=v.channel AND l.revision<>? AND NOT(l.status='failed' AND l.external LIKE 'PENDING-%')").get(page.version,page.id);
      if(prior)fail("기존 등록번호가 있습니다. 판매자센터에서 수정 후 같은 번호를 기록하세요.");
      const candidate=JSON.parse(db.prepare("SELECT body FROM versions WHERE id=?").get(page.version).body);
      if(candidate.evidence?.supplierCode){
        const row=await currentSupply(candidate);
        if(row.stock<Number(page.draft.stock)||row.cost!==Number(candidate.input.cost)||row.freight!==candidate.result.appliedFreight||row.rights!==true||row.minimum!==1||row.floor>page.price)fail("공급 가격·재고·배송·권리 조건 변경 또는 미확인 · 재검토가 필요합니다.");
      }
      const image=await provider.upload(page);
      readPage();
      const id=ops({mode:"manual",action:"publish",version:page.version,revision:page.id,external:"PENDING-"+page.id}).id;
      // 이미지 업로드 중 겹친 요청은 같은 예약을 공유한다. 발송 표식은 네트워크 호출 전에 확정한다.
      const claimed=db.prepare("UPDATE listings SET status='pending',reason='실등록 접수 확인 중' WHERE id=? AND external=? AND (reason='등록 후 조회 대기' OR status='failed')").run(id,"PENDING-"+page.id);
      if(!claimed.changes)return {message:"진행 중인 등록 결과를 확인하세요."};
      db.prepare("INSERT INTO ops_events(listing,action) VALUES(?,'live_submit')").run(id);
      try{
        const receipt=await provider.submit(page,page.draft.marketProfile,image);
        db.prepare("UPDATE listings SET external=?,site_external=?,reason='등록 후 조회 대기' WHERE id=?").run(receipt.external??receipt,receipt.siteExternal??null,id);
      }catch(error){
        if(error.rejected){
          db.prepare("UPDATE listings SET status='failed',reason=?,updated=CURRENT_TIMESTAMP WHERE id=?").run(error.message,id);
          db.prepare("INSERT INTO ops_events(listing,action) VALUES(?,'failed')").run(id);
        }else db.prepare("UPDATE listings SET reason='접수 여부 확인 필요 · 판매자센터에서 판매자 관리코드로 확인' WHERE id=?").run(id);
        throw error;
      }
      entry=db.prepare("SELECT * FROM listings WHERE id=?").get(id);
    }
    if(entry.external.startsWith("PENDING-"))fail("판매자센터에서 판매자 관리코드 ACC-"+page.version+" 조회 후 원상품번호를 기록하세요.");
    try{
      const observed=await provider.read(entry.external,page);
      const result=ops({action:"verify",listing:entry.id,mode:"manual",...observed});
      return {message:result.reason};
    }catch(error){
      db.prepare("UPDATE listings SET status='pending',reason='마켓 재조회 실패 · 판매자센터 확인 필요',observed=NULL,updated=CURRENT_TIMESTAMP WHERE id=?").run(entry.id);
      db.prepare("INSERT INTO ops_events(listing,action) VALUES(?,'read_unavailable')").run(entry.id);
      throw error;
    }
  }
  async function currentSupply(candidate){
    const code=candidate.evidence?.supplierCode;
    if(!code)fail("도매매에서 가져온 실상품이 아닙니다.");
    const snapshot=await require("./supplier-provider").fetchCatalog({code,keyword:candidate.input.name.slice(0,100),limit:1});
    const row=snapshot.rows.find(item=>item.code===code);
    if(!row||row.cost===null||row.stock===null)fail("현재 공급가격·재고를 확인할 수 없습니다.");
    return row;
  }
  let monitoring=false,closing=false;
  async function monitor(){
    if(monitoring)return;
    monitoring=true;
    try{
      const entries=db.prepare(`SELECT l.*,v.body,v.channel FROM listings l JOIN versions v ON v.id=l.version
        WHERE v.mode='manual' AND l.id IN (SELECT MAX(j.id) FROM listings j JOIN versions w ON w.id=j.version WHERE w.mode='manual' GROUP BY w.identity,w.channel)`).all();
      for(const entry of entries){
        if(closing)break;
        const candidate=JSON.parse(entry.body);
        if(candidate.evidence?.supplierCode&&process.env.ACC_SUPPLIER_KEY){
          try{
            const {stock,cost}=await currentSupply(candidate);
            ops({mode:"manual",action:"supply",listing:entry.id,stock,cost});
          }catch{db.prepare("INSERT INTO ops_events(listing,action) VALUES(?,'supply_unavailable')").run(entry.id);}
        }
        if(!connected(entry.channel)||entry.external.startsWith("PENDING-"))continue;
        try{await marketAction({version:entry.version,revision:entry.revision},false);}
        catch{/* 재조회 실패는 등록 건의 상태와 운영 이력에 기록한다. */}
      }
    }finally{monitoring=false;if(closing)db.close();}
  }
  const server=http.createServer(async(req,res)=>{
    try{
      const host="127.0.0.1:"+server.address().port;
      if(req.headers.host!==host) fail("로컬 주소를 확인하세요.",403);
      const url=new URL(req.url,"http://"+host);
      if(Object.hasOwn(files,url.pathname) && req.method==="GET"){
        res.setHeader("Content-Type",(url.pathname.endsWith(".js")?"application/javascript":"text/html")+"; charset=utf-8");
        return res.end(readFileSync(path.join(__dirname,files[url.pathname])));
      }
      res.setHeader("Content-Type","application/json; charset=utf-8");
      res.setHeader("Cache-Control","no-store");
      if(req.headers.authorization!=="Bearer "+token) fail("실행 창의 관리자 링크로 접속하세요.",403);
      if(req.method==="GET"&&url.pathname==="/api/connections"){
        return res.end(JSON.stringify({supplier:Boolean(process.env.ACC_SUPPLIER_KEY),research:Boolean(process.env.ACC_RESEARCH_URL),content:configured(),naver:connected("네이버"),coupang:connected("쿠팡"),gmarket:connected("G마켓")}));
      }
      if(req.method==="GET" && url.pathname==="/api/batches"){
        const mode=url.searchParams.get("mode")??"fixture";
        if(!url.searchParams.has("id")) return res.end(JSON.stringify(db.prepare("SELECT id,total,created FROM sourcing_batches WHERE mode=? ORDER BY id DESC").all(mode)));
        const row=db.prepare("SELECT snapshot FROM sourcing_batches WHERE id=? AND mode=?").get(url.searchParams.get("id"),mode);
        if(!row) fail("수집 회차를 찾을 수 없습니다.",404);
        return res.end(row.snapshot);
      }
      if(req.method==="GET" && url.pathname==="/api/candidates") return res.end(JSON.stringify(list(url.searchParams.get("mode"))));
      if(req.method!=="POST" || !["/api/demo","/api/market-import","/api/market-submit","/api/market-read","/api/operations","/api/studio","/api/research","/api/batches","/api/candidates","/api/decision"].includes(url.pathname)) fail("지원하지 않는 요청입니다.",404);
      if(req.headers.origin && req.headers.origin!=="http://"+host) fail("접근 권한이 없습니다.",403);
      let body="",size=0;
      req.setEncoding("utf8");
      const limit=url.pathname==="/api/studio"?3200000:512000;
      for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>limit) fail("입력 크기를 줄이세요.");body+=chunk;}
      const data=JSON.parse(body);
      if(url.pathname==="/api/operations"&&data.action==="readSupply"){
        const entry=db.prepare("SELECT v.body FROM listings l JOIN versions v ON v.id=l.version WHERE l.id=? AND v.mode='manual'").get(data.listing);
        if(!entry||data.mode!=="manual")fail("실상품 등록 건을 확인하세요.");
        const row=await currentSupply(JSON.parse(entry.body));
        data.action="supply";data.cost=row.cost;data.stock=row.stock;
      }
      if(url.pathname==="/api/market-import")return res.end(JSON.stringify(await marketplaceImport(data)));
      if(url.pathname==="/api/studio"&&data.action==="supplierImage"){
        const current=studio({action:"open",version:data.version});
        if(current.mode!=="manual"||current.id!==data.base)fail("최신 실상품 초안을 여세요.");
        const {evidence}=JSON.parse(db.prepare("SELECT body FROM versions WHERE id=?").get(data.version).body);
        const image=await require("./supplier-provider").supplierImage(evidence);
        return res.end(JSON.stringify({image}));
      }
      if(url.pathname==="/api/batches"&&data.provider==="domeme"){
        if(data.mode!=="manual")fail("실상품 자료에서 공급처를 조회하세요.");
        const snapshot=await require("./supplier-provider").fetchCatalog(data);
        const stored=db.prepare("INSERT INTO sourcing_batches(mode,total,snapshot) VALUES('manual',?,?)").run(snapshot.rows.length,JSON.stringify(snapshot));
        return res.end(JSON.stringify({id:Number(stored.lastInsertRowid),counts:snapshot.counts}));
      }
      if(url.pathname==="/api/market-submit"||url.pathname==="/api/market-read")return res.end(JSON.stringify(await marketAction(data,url.pathname==="/api/market-submit")));
      let aiReview;
      if(url.pathname==="/api/studio" && (data.action==="write" || (data.action==="save" && configured()))){
        const current=studio({action:"open",version:data.version});
        if(data.base!==current.id)fail("새 게시본을 다시 확인하세요.",409);
        const original=JSON.parse(db.prepare("SELECT body FROM versions WHERE id=?").get(data.version).body);
        const draft=require("./studio").normalize(data.draft,original);
        const {name,option,maker,model}=original.input;
        const facts={name,option,maker,model,channel:current.channel};
        if(data.action==="write")return res.end(JSON.stringify(await contentAI("write",facts,draft)));
        aiReview=await contentAI("review",facts,draft);
      }
      if(url.pathname==="/api/research")return res.end(JSON.stringify(await research(data)));
      db.exec("BEGIN IMMEDIATE");
      try {const result=command(url.pathname,data,aiReview);db.exec("COMMIT");res.end(JSON.stringify(result));}
      catch(error){db.exec("ROLLBACK");throw error;}
    }catch(error){res.statusCode=error.status??400;res.end(JSON.stringify({error:error.message}));}
  });
  const timer=setInterval(()=>monitor().catch(()=>{}),60*60*1000);
  timer.unref();
  server.on("close",()=>{clearInterval(timer);closing=true;if(!monitoring)db.close();});
  return server;
}
if(require.main===module){
  const directory=path.join(__dirname,"data");
  mkdirSync(directory,{recursive:true});
  const token=randomBytes(32).toString("hex");
  const server=createApp(path.join(directory,"candidates.sqlite"),token);
  server.listen(Number(process.env.PORT??4173),"127.0.0.1",()=>console.log("관리자 접속 주소 http://127.0.0.1:"+server.address().port+"/#"+token));
}
module.exports={createApp};
