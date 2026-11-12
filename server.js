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
  db.exec("CREATE TABLE IF NOT EXISTS sourcing_batches(id INTEGER PRIMARY KEY, total INTEGER NOT NULL, snapshot TEXT NOT NULL, created TEXT DEFAULT CURRENT_TIMESTAMP)");
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
    if(route==="/api/studio")return {...studio(data,aiReview),ai:configured()};
    if(route==="/api/batches"){
      const snapshot=screen(mockProducts(data.limit));
      const record=db.prepare("INSERT INTO sourcing_batches(total,snapshot) VALUES(?,?)").run(data.limit,JSON.stringify(snapshot));
      return {id:Number(record.lastInsertRowid),...snapshot};
    }
    if(route==="/api/decision"){
      const row=db.prepare("SELECT * FROM versions WHERE id=?").get(data.id);
      if(!row || latest.get(row.mode,row.identity,row.channel).id!==row.id) fail("새 버전을 다시 확인하세요.",409);
      const prior=db.prepare("SELECT choice FROM decisions WHERE version=?").get(row.id);
      if(prior && prior.choice!==data.choice) fail("이미 결정된 버전입니다. 재검토용 버전을 저장하세요.",409);
      if(!["진행","보류","제외"].includes(data.choice)) fail("결정을 선택하세요.");
      const {result,checks}=JSON.parse(row.body);
      if(data.choice==="진행" && (!checks || result.version!==2 || result.profit===null)) fail("시장 가격·수수료와 공급 조건을 확인한 최신 계산서를 저장하세요.");
      db.prepare("INSERT OR IGNORE INTO decisions(version,choice) VALUES(?,?)").run(row.id,data.choice);
      return {id:row.id};
    }
    const {input,samples,mode,channel,checks}=data;
    if(!["fixture","manual"].includes(mode)||!["네이버","쿠팡"].includes(channel)||!input||!Array.isArray(samples)||typeof checks!=="boolean") fail("계산서 형식을 확인하세요.");
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
      const batch=db.prepare("SELECT snapshot FROM sourcing_batches WHERE id=?").get(data.batchId);
      if(mode!=="fixture" || !batch || !JSON.parse(batch.snapshot).rows.some(row=>row.status==="조사 대상" && row.source===source && row.option===option)) fail("조사 대상과 회차 정보를 확인하세요.");
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
      if(req.method==="GET" && url.pathname==="/api/batches"){
        if(!url.searchParams.has("id")) return res.end(JSON.stringify(db.prepare("SELECT id,total,created FROM sourcing_batches ORDER BY id DESC").all()));
        const row=db.prepare("SELECT snapshot FROM sourcing_batches WHERE id=?").get(url.searchParams.get("id"));
        if(!row) fail("수집 회차를 찾을 수 없습니다.",404);
        return res.end(row.snapshot);
      }
      if(req.method==="GET" && url.pathname==="/api/candidates") return res.end(JSON.stringify(list(url.searchParams.get("mode"))));
      if(req.method!=="POST" || !["/api/studio","/api/research","/api/batches","/api/candidates","/api/decision"].includes(url.pathname)) fail("지원하지 않는 요청입니다.",404);
      if(req.headers.origin && req.headers.origin!=="http://"+host) fail("접근 권한이 없습니다.",403);
      let body="",size=0;
      req.setEncoding("utf8");
      const limit=url.pathname==="/api/studio"?3200000:512000;
      for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>limit) fail("입력 크기를 줄이세요.");body+=chunk;}
      const data=JSON.parse(body);
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
  server.on("close",()=>db.close());
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
