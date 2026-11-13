"use strict";

const statuses = {
  pending:"확인 대기", verified:"검증 성공", mismatch:"가격 불일치",
  failed:"등록 실패", paused:"판매 보류"
};

function integer(value,label){
  if(!/^\d{1,9}$/.test(String(value)))throw Error(label+"에 0 이상 정수를 입력하세요.");
  return Number(value);
}

function compareListing(expected,observed){
  if(observed.sale==="rejected")return {status:"failed",reason:"마켓 등록 반려"};
  if(observed.sale==="pending")return {status:"pending",reason:"마켓 반영 대기"};
  if(observed.sale!=="selling")return {status:"paused",reason:"판매 중지"};
  for(const key of ["price","shipping","extra","discount"]){
    if(observed[key]!==expected[key]){
      const name={price:"상품가",shipping:"배송비",extra:"옵션 추가금",discount:"판매자 할인"}[key];
      return {status:"mismatch",reason:name+" 승인 "+expected[key]+"원 / 조회 "+observed[key]+"원"};
    }
  }
  if(observed.option!==expected.option||observed.stock!==expected.stock)
    return {status:"paused",reason:"옵션 또는 판매가능수량 불일치"};
  return {status:"verified",reason:"판매 중 · 모든 판매 조건 일치"};
}

function operations(db,studio){
  db.exec(`CREATE TABLE IF NOT EXISTS listings(
    id INTEGER PRIMARY KEY,version INTEGER NOT NULL,revision INTEGER UNIQUE NOT NULL,
    external TEXT NOT NULL,expected TEXT NOT NULL,observed TEXT,status TEXT NOT NULL,reason TEXT NOT NULL,
    updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS fixture_offers(external TEXT PRIMARY KEY,body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ops_events(id INTEGER PRIMARY KEY,listing INTEGER NOT NULL,action TEXT NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS order_lines(id INTEGER PRIMARY KEY,listing INTEGER NOT NULL,ref TEXT NOT NULL,qty INTEGER NOT NULL,
    paid INTEGER NOT NULL,cost INTEGER NOT NULL,freight INTEGER NOT NULL,stage TEXT NOT NULL,
    received INTEGER,loss INTEGER,updated TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(listing,ref));
    CREATE TABLE IF NOT EXISTS supply_checks(id INTEGER PRIMARY KEY,listing INTEGER NOT NULL,cost INTEGER NOT NULL,stock INTEGER NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP);`);
  db.exec(`CREATE TABLE IF NOT EXISTS order_returns(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL,ref TEXT NOT NULL,
    qty INTEGER NOT NULL,recovery INTEGER NOT NULL,expense INTEGER NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(order_id,ref))`);
  if(!db.prepare("PRAGMA table_info(listings)").all().some(column=>column.name==="site_external"))
    db.exec("ALTER TABLE listings ADD COLUMN site_external TEXT");
  function event(id,action){db.prepare("INSERT INTO ops_events(listing,action) VALUES(?,?)").run(id,action);}
  function listing(id,mode){
    const row=db.prepare("SELECT l.*,v.mode,v.channel FROM listings l JOIN versions v ON l.version=v.id WHERE l.id=? AND v.mode=?").get(id,mode);
    if(!row)throw Error("선택한 자료에서 등록 건을 찾을 수 없습니다.");
    return row;
  }
  function observation(data){
    if(!["pending","rejected","selling","stopped"].includes(data.sale))throw Error("판매 상태를 확인하세요.");
    if(data.sale!=="selling")return {sale:data.sale};
    if(typeof data.option!=="string"||!data.option.trim())throw Error("조회한 옵션을 입력하세요.");
    const result={sale:data.sale,option:data.option.trim()};
    for(const [key,label] of Object.entries({price:"등록가",shipping:"배송비",extra:"옵션 추가금",discount:"할인",stock:"재고"}))result[key]=integer(data[key],label);
    return result;
  }
  function verify(row,observed){
    const result=compareListing(JSON.parse(row.expected),observed);
    db.prepare("UPDATE listings SET observed=?,status=?,reason=?,updated=CURRENT_TIMESTAMP WHERE id=?")
      .run(JSON.stringify(observed),result.status,result.reason,row.id);
    event(row.id,result.status);
    return result;
  }
  function report(mode){
    const items=db.prepare("SELECT l.*,v.channel,v.body FROM listings l JOIN versions v ON v.id=l.version WHERE v.mode=? AND l.id IN (SELECT MAX(j.id) FROM listings j JOIN versions w ON w.id=j.version GROUP BY w.mode,w.identity,w.channel) ORDER BY l.id DESC").all(mode).map(({body,expected,observed,...row})=>{
      const {input,result,evidence}=JSON.parse(body);
      return {...row,canReadSupply:Boolean(evidence?.supplierCode),name:input.name,cost:input.cost,margin:result.margin,strength:result.assessment?.strength,expected:JSON.parse(expected),observed:JSON.parse(observed),label:statuses[row.status]};
    });
    const orders=db.prepare("SELECT o.*,v.channel,json_extract(v.body,'$.result.profit')*o.qty AS estimated FROM order_lines o JOIN listings l ON l.id=o.listing JOIN versions v ON v.id=l.version WHERE v.mode=? ORDER BY o.id DESC").all(mode);
    const events=db.prepare("SELECT e.* FROM ops_events e JOIN listings l ON e.listing=l.id JOIN versions v ON l.version=v.id WHERE v.mode=? ORDER BY e.id DESC LIMIT 100").all(mode);
    const supply=db.prepare("SELECT s.* FROM supply_checks s JOIN listings l ON l.id=s.listing JOIN versions v ON l.version=v.id WHERE v.mode=? AND s.id IN (SELECT MAX(id) FROM supply_checks GROUP BY listing)").all(mode);
    const returns=db.prepare("SELECT r.* FROM order_returns r JOIN order_lines o ON r.order_id=o.id JOIN listings l ON o.listing=l.id JOIN versions v ON l.version=v.id WHERE v.mode=? ORDER BY r.id").all(mode);
    const weekly=db.prepare(`SELECT COUNT(*) AS count, SUM(received-cost-freight-loss+COALESCE((SELECT SUM(recovery-expense) FROM order_returns WHERE order_id=o.id),0)) AS profit FROM order_lines o JOIN listings l ON o.listing=l.id JOIN versions v ON v.id=l.version
      WHERE v.mode=? AND received IS NOT NULL AND date(o.updated,'+9 hours')>=date('now','+9 hours','-6 days')`).get(mode);
    const approvals=db.prepare(`SELECT v.id AS version,v.channel,d.choice AS action,d.created,1 AS gate FROM decisions d JOIN versions v ON v.id=d.version WHERE v.mode=?
      UNION ALL SELECT v.id,v.channel,d.action,d.created,2 FROM detail_decisions d JOIN detail_revisions r ON r.id=d.revision JOIN versions v ON v.id=r.version WHERE v.mode=?
      UNION ALL SELECT v.id,v.channel,'approve',a.created,2 FROM detail_approvals a JOIN detail_revisions r ON r.id=a.revision JOIN versions v ON v.id=r.version WHERE v.mode=? AND NOT EXISTS (SELECT 1 FROM detail_decisions d WHERE d.revision=r.id AND d.action='approve')
      ORDER BY 4 DESC LIMIT 100`).all(mode,mode,mode);
    return {items,orders,events,supply,weekly,returns,approvals};
  }
  return function handle(data){
    const {mode,action}=data;
    if(!["fixture","manual"].includes(mode))throw Error("자료 종류를 선택하세요.");
    if(action==="report")return report(mode);
    if(action==="publish"){
      const page=studio({action:"export",version:data.version,base:data.revision});
      if(page.mode!==mode)throw Error("승인 자료 종류가 다릅니다.");
      const previous=db.prepare("SELECT id FROM listings WHERE revision=?").get(page.id);
      if(previous){
        const existing=listing(previous.id,mode);
        if(existing.external.startsWith("PENDING-")&&mode==="manual"&&/^\d+$/.test(String(data.external))){
          if(db.prepare("SELECT 1 FROM listings l JOIN versions v ON l.version=v.id WHERE l.external=? AND v.channel=? AND v.mode=?").get(String(data.external),existing.channel,mode))throw Error("다른 등록 건의 번호입니다.");
          db.prepare("UPDATE listings SET external=?,reason='판매자센터 번호 입력 · 조회 대기' WHERE id=?").run(String(data.external),existing.id);
          event(existing.id,"manual_submit");
        }
        return {id:previous.id};
      }
      const stock=integer(page.draft.stock,"승인 재고");
      if(!stock)throw Error("판매 수량을 입력하고 다시 승인하세요.");
      const prior=db.prepare("SELECT l.external FROM listings l JOIN versions v ON v.id=l.version JOIN versions cur ON cur.id=? WHERE v.identity=cur.identity AND v.mode=cur.mode AND v.channel=cur.channel AND NOT(l.status='failed' AND l.external LIKE 'PENDING-%') ORDER BY l.id DESC LIMIT 1").get(page.version);
      const external=mode==="fixture"?(prior?.external??"DEMO-"+page.version):String(data.external??"").trim();
      if(!/^[a-zA-Z0-9_-]{1,80}$/.test(external)||prior&&prior.external!==external)throw Error("같은 상품의 판매자센터 등록번호를 확인하세요.");
      const conflict=db.prepare("SELECT 1 FROM listings l JOIN versions v ON v.id=l.version JOIN versions cur ON cur.id=? WHERE l.external=? AND v.mode=cur.mode AND v.channel=cur.channel AND cur.identity<>v.identity").get(page.version,external);
      if(conflict)throw Error("다른 상품의 등록번호와 중복됩니다.");
      const expected={price:page.price,shipping:Number(page.shipping),option:page.option,extra:0,discount:0,stock};
      const id=Number(db.prepare("INSERT INTO listings(version,revision,external,expected,status,reason) VALUES(?,?,?,?,'pending',?)").run(page.version,page.id,external,JSON.stringify(expected),"등록 후 조회 대기").lastInsertRowid);
      event(id,mode==="fixture"?"fixture_submit":"manual_submit");
      if(mode==="fixture"){
        db.prepare("INSERT OR REPLACE INTO fixture_offers VALUES(?,?)").run(external,JSON.stringify({...expected,sale:"selling"}));
        verify(listing(id,mode),JSON.parse(db.prepare("SELECT body FROM fixture_offers WHERE external=?").get(external).body));
      }
      return {id};
    }
    const row=listing(data.listing,mode);
    if(action==="supply"){
      const cost=integer(data.cost,"확인한 매입가"),stock=integer(data.stock,"공급 재고");
      db.prepare("INSERT INTO supply_checks(listing,cost,stock) VALUES(?,?,?)").run(row.id,cost,stock);
      event(row.id,"supply");return {id:row.id};
    }
    if(action==="verify"){
      const observed=mode==="fixture"?JSON.parse(db.prepare("SELECT body FROM fixture_offers WHERE external=?").get(row.external).body):observation(data);
      return verify(row,observed);
    }
    if(action==="simulate"&&mode==="fixture"){
      db.prepare("UPDATE fixture_offers SET body=? WHERE external=?").run(JSON.stringify(observation(data)),row.external);
      event(row.id,"fixture_change");
      return {id:row.id};
    }
    if(action==="order"){
      if(!/^[A-Za-z0-9_-]{1,80}$/.test(data.ref??""))throw Error("주문행 번호를 입력하세요.");
      const qty=integer(data.qty,"수량");
      if(!qty)throw Error("수량은 1 이상입니다.");
      const paid=integer(data.paid,"구매자 결제액"),cost=integer(data.cost,"총 매입액"),freight=integer(data.freight,"공급 배송비");
      const old=db.prepare("SELECT o.* FROM order_lines o JOIN listings l ON o.listing=l.id JOIN versions v ON v.id=l.version WHERE v.mode=? AND v.channel=? AND o.ref=?").get(mode,row.channel,data.ref);
      if(old){
        if(old.listing!==row.id||old.qty!==qty||old.paid!==paid||old.cost!==cost||old.freight!==freight)throw Error("같은 주문행 번호의 기존 값과 다릅니다.");
        return {id:old.id};
      }
      const id=Number(db.prepare("INSERT INTO order_lines(listing,ref,qty,paid,cost,freight,stage) VALUES(?,?,?,?,?,?,'ordered')").run(row.id,data.ref,qty,paid,cost,freight).lastInsertRowid);
      event(row.id,"order");return {id};
    }
    const order=db.prepare("SELECT * FROM order_lines WHERE id=? AND listing=?").get(data.order??0,row.id);
    if(!order)throw Error("주문행을 확인하세요.");
    if(action==="return"){
      if(!["shipped","delivered","returned"].includes(order.stage))throw Error("출고한 주문의 반품만 기록할 수 있습니다.");
      if(!/^[A-Za-z0-9_-]{1,80}$/.test(data.ref??""))throw Error("반품행 번호를 확인하세요.");
      const qty=integer(data.qty,"반품 수량"),recovery=integer(data.recovery,"공급처 환급액"),expense=integer(data.expense,"반품 실비");
      const old=db.prepare("SELECT * FROM order_returns WHERE order_id=? AND ref=?").get(order.id,data.ref);
      if(old){
        if(old.qty!==qty||old.recovery!==recovery||old.expense!==expense)throw Error("기존 반품행과 다릅니다.");
        return {id:old.id};
      }
      const prior=db.prepare("SELECT COALESCE(SUM(qty),0) AS qty FROM order_returns WHERE order_id=?").get(order.id);
      if(!qty||qty+prior.qty>order.qty)throw Error("반품 수량이 주문의 남은 수량을 벗어납니다.");
      const id=Number(db.prepare("INSERT INTO order_returns(order_id,ref,qty,recovery,expense) VALUES(?,?,?,?,?)").run(order.id,data.ref,qty,recovery,expense).lastInsertRowid);
      db.prepare("UPDATE order_lines SET received=NULL,loss=NULL,stage=?,updated=CURRENT_TIMESTAMP WHERE id=?").run(qty+prior.qty===order.qty?"returned":order.stage,order.id);
      event(row.id,"return_line");return {id};
    }
    if(action==="advance"){
      const next={ordered:["purchased","cancelled"],purchased:["shipped","cancelled"],shipped:["delivered","returned"],delivered:["returned"]};
      if(data.stage===order.stage)return {id:order.id};
      if(!next[order.stage]?.includes(data.stage))throw Error("주문 상태 순서를 확인하세요.");
      db.prepare("UPDATE order_lines SET stage=?,received=NULL,loss=NULL,updated=CURRENT_TIMESTAMP WHERE id=?").run(data.stage,order.id);
      event(row.id,data.stage);
    }else if(action==="settle"){
      if(!["delivered","returned","cancelled"].includes(order.stage))throw Error("배송·취소·반품 완료 후 정산하세요.");
      if(!/^-?\d{1,9}$/.test(String(data.received)))throw Error("실정산액을 원 단위 정수로 입력하세요. 환불 차감액은 음수로 입력할 수 있습니다.");
      const received=Number(data.received),loss=integer(data.loss,"추가 차감 실비");
      if(order.received!==received||order.loss!==loss){
        db.prepare("UPDATE order_lines SET received=?,loss=?,updated=CURRENT_TIMESTAMP WHERE id=?").run(received,loss,order.id);
        event(row.id,"settle");
      }
    }else throw Error("지원하지 않는 운영 요청입니다.");
    return {id:order.id};
  };
}
module.exports={operations,compareListing};
