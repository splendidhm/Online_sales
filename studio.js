function textValue(value){return typeof value==="string"?value.trim():"";}

function generateDraft(candidate){
  const {input}=candidate;
  return {title:[input.name,input.option].join(" "),body:[input.name,"구성 · "+input.option,input.model && "모델 · "+input.model].filter(Boolean).join("\n"),
    origin:"",disclosure:"",returns:"",source:input.source||"",rights:"",image:"",imageText:"",imageReviewed:false};
}

function review(draft,candidate){
  const issues=[];
  const flag=(field,message)=>issues.push({field,message});
  for(const [field,label] of Object.entries({title:"상품명",body:"상세 설명",origin:"원산지",disclosure:"품목별 상품정보고시",returns:"배송·반품 안내",source:"공급 정보 출처",rights:"해당 채널의 이미지 사용 근거"})){
    if(!textValue(draft[field]))flag(field,label+"를 공급 근거에서 확인해 입력하세요.");
  }
  if(!draft.title.includes(candidate.input.name))flag("title","승인된 상품명을 포함하세요.");
  if(![draft.title,draft.body].join(" ").includes(candidate.input.option))flag("body","승인된 구성·수량을 확인하세요.");
  if(!draft.image)flag("image","사용 허가된 상품 사진을 첨부하세요.");
  if(draft.imageReviewed!==true)flag("imageReviewed","사진 속 문구와 실물 일치 여부를 확인하세요.");
  for(const key of ["title","body","imageText","disclosure","returns"]){
    const match=draft[key].match(/항균|살균|효능|치료|무독성|국내\s*유일|업계\s*1위|최저가\s*보장|100\s*%\s*보장/);
    if(match)flag(key,"‘"+match[0]+"’ 표현을 삭제하거나 확인된 중립적 사양으로 수정하세요.");
    if(/할수 있|되여|됬/.test(draft[key]))flag(key,"띄어쓰기 또는 맞춤법을 확인하세요 (‘할 수 있’, ‘되어’, ‘됐’).");
  }
  return issues;
}

function normalize(draft,candidate){
  const result=generateDraft(candidate);
  for(const key of Object.keys(result)){
    if(key==="imageReviewed")result[key]=draft[key]===true;
    else result[key]=textValue(draft[key]);
    if(key!=="image" && String(result[key]).length>12000)throw Error("입력 문구가 너무 깁니다.");
  }
  if(result.image){
    const parts=result.image.match(/^data:image\/(png|jpeg);base64,([a-zA-Z0-9+/]+=*)$/);
    if(!parts)throw Error("PNG 또는 JPEG 이미지를 선택하세요.");
    const bytes=Buffer.from(parts[2],"base64");
    const signature=parts[1]==="png"?"89504e470d0a1a0a":"ffd8ff";
    if(bytes.length>2*1024*1024 || !bytes.subarray(0,signature.length/2).equals(Buffer.from(signature,"hex")))throw Error("2MB 이하의 올바른 이미지가 필요합니다.");
  }
  return result;
}

function studioStore(db){
  db.exec(`CREATE TABLE IF NOT EXISTS detail_revisions(id INTEGER PRIMARY KEY, version INTEGER NOT NULL, content TEXT NOT NULL, created TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS detail_by_version ON detail_revisions(version,id);
    CREATE TABLE IF NOT EXISTS detail_approvals(revision INTEGER PRIMARY KEY, created TEXT DEFAULT CURRENT_TIMESTAMP)`);
  db.exec("CREATE TABLE IF NOT EXISTS detail_ai_reviews(revision INTEGER PRIMARY KEY, issues TEXT NOT NULL)");
  return function handle(data,aiReview){
    const row=db.prepare(`SELECT v.*, d.choice FROM versions v LEFT JOIN decisions d ON v.id=d.version
      WHERE v.id=? AND v.id=(SELECT MAX(id) FROM versions WHERE identity=v.identity AND channel=v.channel AND mode=v.mode)`).get(data.version);
    if(row?.choice!=="진행")throw Error("최신 계산서의 1차 진행 승인이 필요합니다.");
    const candidate=JSON.parse(row.body);
    const last=db.prepare("SELECT * FROM detail_revisions WHERE version=? ORDER BY id DESC LIMIT 1").get(row.id);
    let id=last?.id??0, draft=last?JSON.parse(last.content):generateDraft(candidate);
    if(data.action!=="open" && data.base!==id)throw Error("게시본이 변경되었습니다. 다시 여세요.");
    if(data.action==="save"){
      draft=normalize(data.draft,candidate);
      const content=JSON.stringify(draft);
      if(content!==last?.content)id=Number(db.prepare("INSERT INTO detail_revisions(version,content) VALUES(?,?)").run(row.id,content).lastInsertRowid);
    }else if(!["open","approve","export"].includes(data.action))throw Error("지원하지 않는 편집 요청입니다.");
    if(aiReview && id)db.prepare("INSERT OR IGNORE INTO detail_ai_reviews(revision,issues) VALUES(?,?)").run(id,JSON.stringify(aiReview));
    const issues=review(draft,candidate);
    const savedReview=db.prepare("SELECT issues FROM detail_ai_reviews WHERE revision=?").get(id);
    if(savedReview)issues.push(...JSON.parse(savedReview.issues));
    else if(require("./content-ai").configured())issues.push({field:"body",message:"현재 AI 연결로 수정본을 저장해 사진과 문안을 검수하세요."});
    if(data.action==="approve"){
      if(!id||issues.length)throw Error("검수 항목을 보완하고 저장하세요.");
      db.prepare("INSERT OR IGNORE INTO detail_approvals(revision) VALUES(?)").run(id);
    }
    const approved=!!db.prepare("SELECT revision FROM detail_approvals WHERE revision=?").get(id);
    if(data.action==="export" && (!approved || issues.length))throw Error("현재 게시본의 검수와 2차 승인이 필요합니다.");
    return {version:row.id,id,approved,issues,draft,channel:row.channel,mode:row.mode,option:candidate.input.option,
      price:candidate.result.reference,shipping:candidate.input.shipping};
  };
}
module.exports={studioStore,normalize};
