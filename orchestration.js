"use strict";

const {randomUUID} = require("node:crypto");
const {investigate, validateEvidence} = require("./orchestration-evidence");
const {analyze, rank, exportWorkbook} = require("./orchestration-finance");
const {analysisAI} = require("./orchestration-ai");

const channelsSupported = ["네이버", "쿠팡"];
const roles = {research:"조사 담당", validation:"검증 담당", analysis:"데이터 분석 담당", leader:"팀 리더"};
const active = ["PENDING", "RUNNING", "VALIDATING", "REVISION_REQUIRED", "APPROVED"];
const text = (value, max = 300) => typeof value === "string" ? value.trim().slice(0, max) : "";
const number = value => /^\d{1,9}$/.test(String(value)) ? Number(value) : null;
const clock = () => new Date().toISOString();

function fail(message, status = 400) {
  throw Object.assign(Error(message), {status});
}

function modeOf(mode) {
  if (!["fixture", "manual"].includes(mode)) fail("자료 종류를 확인하세요.");
  return mode;
}

function channelSettings(channel, settings, mode) {
  const value = settings?.[channel] ?? {};
  const shipping = number(value.shipping ?? 0);
  const top = number(value.top ?? 5);
  if (shipping === null || ![5, 10].includes(top)) fail("구매자 배송비와 리뷰 표본 수를 확인하세요.");
  const grade = text(value.grade) || (mode === "fixture" ? "일반" : "");
  const category = text(value.category) || (mode === "fixture" ? "수납/정리용품" : "");
  return {...(channel === "네이버" ? {grade} : {category}), shipping, top};
}

function candidateInput(product, settings) {
  return {name:product.name, maker:product.maker || "", model:product.model || "", option:product.option,
    source:product.source, quantity:product.quantity, keywords:product.keywords || product.name,
    cost:product.cost, freight:product.freight, stock:product.stock, floor:product.floor,
    freeAbove:product.freeAbove, ...settings};
}

function sampleSupplement(samples) {
  if (!Array.isArray(samples) || samples.length > 100) fail("시장 표본은 최대 100개까지 입력할 수 있습니다.");
  const stringKeys = ["title", "maker", "model", "option", "seller", "url", "time", "offerType", "condition"];
  const numberKeys = ["quantity", "reviews", "price", "shipping", "regularPrice", "promoPrice"];
  return samples.map(sample => {
    if (!sample || typeof sample !== "object" || sample.confirmed !== true) fail("확인한 시장 표본을 입력하세요.");
    const clean = Object.fromEntries(stringKeys.map(key => [key, text(sample[key], key === "url" ? 2000 : 300)]));
    for (const key of numberKeys) {
      const value = number(sample[key]);
      if (value !== null) clean[key] = value;
    }
    return {...clean, match:sample.match === true, confirmed:true};
  });
}

function orchestration(db, {ai = analysisAI(), schedule = true, leaseMs = 180000, dependencies = {}} = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS orchestration_runs (
    id INTEGER PRIMARY KEY, mode TEXT NOT NULL, batch_id INTEGER NOT NULL, channels TEXT NOT NULL,
    settings TEXT NOT NULL, created TEXT NOT NULL, UNIQUE(mode,batch_id,channels));
    CREATE TABLE IF NOT EXISTS orchestration_candidates (
      id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES orchestration_runs(id), channel TEXT NOT NULL,
      status TEXT NOT NULL, body TEXT NOT NULL, lease TEXT, lease_until INTEGER);
    CREATE INDEX IF NOT EXISTS orchestration_candidate_run ON orchestration_candidates(run_id,id);
    CREATE TABLE IF NOT EXISTS orchestration_events (
      id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES orchestration_runs(id),
      candidate_id INTEGER REFERENCES orchestration_candidates(id), role TEXT NOT NULL,
      status TEXT NOT NULL, message TEXT NOT NULL, created TEXT NOT NULL, detail TEXT);`);

  const runRow = db.prepare("SELECT * FROM orchestration_runs WHERE id=? AND mode=?");
  const candidateRows = db.prepare("SELECT * FROM orchestration_candidates WHERE run_id=? ORDER BY id");
  const addEvent = db.prepare(`INSERT INTO orchestration_events(run_id,candidate_id,role,status,message,created,detail)
    VALUES(?,?,?,?,?,?,?)`);
  const writeCandidate = db.prepare("UPDATE orchestration_candidates SET status=?, body=?, lease=NULL, lease_until=NULL WHERE id=? AND lease=?");
  let pending = null;
  let stopped = false;

  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  function event(runId, candidateId, role, status, message, detail = null) {
    addEvent.run(runId, candidateId, role, status, message, clock(), detail === null ? null : JSON.stringify(detail));
  }

  function summarize(row, candidates) {
    const statuses = candidates.map(candidate => candidate.status);
    let status = statuses.every(value => value === "PENDING") && statuses.length ? "PENDING" : "COMPLETED";
    if (status !== "PENDING" && statuses.some(value => active.includes(value))) status = "RUNNING";
    if (status === "COMPLETED" && statuses.includes("BLOCKED")) status = "BLOCKED";
    if (status === "COMPLETED" && statuses.length && statuses.every(value => value === "FAILED")) status = "FAILED";
    return {id:row.id, mode:row.mode, batchId:row.batch_id, channels:JSON.parse(row.channels), created:row.created,
      status, total:statuses.length, completed:statuses.filter(value => !active.includes(value)).length, ai:row.mode === "manual" && Boolean(ai)};
  }

  function start({mode, batchId, channels, settings}) {
    modeOf(mode);
    if (!Number.isSafeInteger(batchId) || !Array.isArray(channels) || !channels.length || channels.some(c => !channelsSupported.includes(c))) fail("수집 회차와 분석 마켓을 선택하세요.");
    const selected = channelsSupported.filter(channel => channels.includes(channel));
    const normalized = Object.fromEntries(selected.map(channel => [channel, channelSettings(channel, settings, mode)]));
    const id = transaction(() => {
      const prior = db.prepare("SELECT id FROM orchestration_runs WHERE mode=? AND batch_id=? AND channels=?").get(mode, batchId, JSON.stringify(selected));
      if (prior) return prior.id;
      const batch = db.prepare("SELECT snapshot FROM sourcing_batches WHERE id=? AND mode=?").get(batchId, mode);
      if (!batch) fail("선택한 자료에서 수집 회차를 찾을 수 없습니다.", 404);
      const products = JSON.parse(batch.snapshot).rows.filter(p => p.status === "조사 대상").slice(0, 10);
      const result = db.prepare("INSERT INTO orchestration_runs(mode,batch_id,channels,settings,created) VALUES(?,?,?,?,?)")
        .run(mode, batchId, JSON.stringify(selected), JSON.stringify(normalized), clock());
      const runId = Number(result.lastInsertRowid);
      const insert = db.prepare("INSERT INTO orchestration_candidates(run_id,channel,status,body) VALUES(?,?,'PENDING',?)");
      for (const candidate of products) for (const channel of selected) {
        insert.run(runId, channel, JSON.stringify({candidate, input:candidateInput(candidate, normalized[channel]), revisions:0}));
      }
      event(runId, null, "leader", products.length ? "PENDING" : "COMPLETED",
        products.length ? `규칙 선별 상품 ${products.length}개에서 ${selected.length}개 마켓을 조사합니다.` : "이번 회차에 규칙 선별을 통과한 조사 대상이 없습니다. 수집 회차의 보완 사유를 확인하세요.");
      return runId;
    });
    kick();
    return {id};
  }

  function list(mode) {
    return db.prepare("SELECT * FROM orchestration_runs WHERE mode=? ORDER BY id DESC LIMIT 50").all(modeOf(mode))
      .map(row => summarize(row, candidateRows.all(row.id)));
  }

  function detail(id, mode) {
    const row = runRow.get(id, modeOf(mode));
    if (!row) fail("분석 회차를 찾을 수 없습니다.", 404);
    const candidates = candidateRows.all(id).map(entry => {
      const {input, investigation, validation, analysis, revisions, notes, reason} = JSON.parse(entry.body);
      return {id:entry.id, channel:entry.channel, status:entry.status, input, samples:validation?.samples ?? investigation?.samples ?? [], validation, analysis, revisions, notes, reason};
    });
    const events = db.prepare(`SELECT candidate_id AS candidateId, role, status, message, created, detail
      FROM orchestration_events WHERE run_id=? ORDER BY id`).all(id).map(entry => ({...entry, detail:entry.detail ? JSON.parse(entry.detail) : null}));
    const summary = summarize(row, candidates);
    return {...summary, updated:events.at(-1)?.created, candidates, events,
      ranking:rank(candidates.filter(candidate => candidate.status === "COMPLETED")), actuals:actuals(summary)};
  }

  function supplement(id, {mode, candidateId, manualSamples, evidence, returnCost, settings}) {
    modeOf(mode);
    if (mode !== "manual" || !Number.isSafeInteger(candidateId)) fail("실상품 보완 대상을 선택하세요.");
    if ([manualSamples,evidence,returnCost,settings].every(value => value === undefined)) fail("추가할 근거를 입력하세요.");
    const result = transaction(() => {
      if (!runRow.get(id, mode)) fail("분석 회차를 찾을 수 없습니다.", 404);
      const row = db.prepare("SELECT * FROM orchestration_candidates WHERE id=? AND run_id=?").get(candidateId, id);
      if (!row || !["BLOCKED","FAILED"].includes(row.status)) fail("보완 대기 상태를 다시 확인하세요.", 409);
      const data = JSON.parse(row.body);
      if (manualSamples !== undefined) data.manualSamples = sampleSupplement(manualSamples);
      if (evidence !== undefined) {
        const keys = ["source", "time", "origin", "disclosure", "certification", "rights"];
        if (evidence?.verified !== true || keys.some(key => !text(evidence[key])) || text(evidence.source, 2000) !== data.candidate.source) fail("공급 원본과 고시·인증·권리 확인 내역을 입력하세요.");
        data.supplyConfirmation = {...Object.fromEntries(keys.map(key => [key, text(evidence[key], key === "source" ? 2000 : 500)])), verified:true};
      }
      if (returnCost !== undefined) {
        data.returnCost = number(returnCost);
        if (data.returnCost === null) fail("반품 실비를 0원 이상 입력하세요.");
      }
      if (settings !== undefined) Object.assign(data.input, channelSettings(row.channel, {[row.channel]:{...data.input,...settings}}, mode));
      const prior = data.validation?.issues ?? [];
      delete data.investigation;
      delete data.validation;
      delete data.analysis;
      delete data.notes;
      data.revisions = 0;
      db.prepare("UPDATE orchestration_candidates SET status='PENDING',body=? WHERE id=?").run(JSON.stringify(data), candidateId);
      event(id, candidateId, "leader", "PENDING", "대표자가 새 보완 근거를 제출했습니다.", prior);
      return {id, candidateId};
    });
    kick();
    return result;
  }

  function claim() {
    return transaction(() => {
      const now = Date.now();
      if (db.prepare("SELECT 1 FROM orchestration_candidates WHERE lease_until>? LIMIT 1").get(now)) return null;
      const marks = active.map(() => "?").join(",");
      const row = db.prepare(`SELECT c.*,r.mode FROM orchestration_candidates c JOIN orchestration_runs r ON r.id=c.run_id
        WHERE c.status IN (${marks}) ORDER BY c.run_id,c.id LIMIT 1`).get(...active);
      if (!row) return null;
      const lease = randomUUID();
      const role = row.status === "VALIDATING" ? "validation" : row.status === "APPROVED" ? "analysis" : "research";
      const status = role === "research" ? "RUNNING" : row.status;
      db.prepare("UPDATE orchestration_candidates SET lease=?,lease_until=?,status=? WHERE id=?").run(lease, now + leaseMs, status, row.id);
      event(row.run_id, row.id, role, status, `${roles[role]} 작업을 시작했습니다.`);
      return {...row, lease, role};
    });
  }

  async function note(row, data, role, facts) {
    if (row.mode !== "manual" || !ai) return;
    try {
      data.notes ??= {};
      data.notes[role] = await ai(role, facts);
    } catch {
      data.notes ??= {};
      data.notes[role] = "AI 설명을 불러오지 못했습니다. 저장된 확인 근거를 참고하세요.";
    }
  }

  async function advance(row, data) {
    const {candidate, input, manualSamples, supplyConfirmation} = data;
    const args = {candidate, input, channel:row.channel, mode:row.mode, manualSamples, supplyConfirmation};
    if (row.role === "research") {
      if (row.mode === "manual" && !manualSamples?.length && !dependencies.research && !process.env.ACC_RESEARCH_URL) {
        return ["BLOCKED", "허가된 검색 공급처를 연결하거나 직접 확인한 시장 표본을 입력하세요."];
      }
      data.investigation = await investigate({...args, feedback:data.validation?.issues ?? []}, dependencies);
      await note(row, data, "research", {channel:row.channel, samples:data.investigation.samples.slice(0, 10).map(({grade, price, shipping, reviews}) => ({grade, price, shipping, reviews}))});
      return ["VALIDATING", "시장 표본과 조사 출처를 저장했습니다."];
    }
    if (row.role === "validation") {
      const validation = await validateEvidence({...args, investigation:data.investigation}, dependencies);
      data.validation = validation;
      await note(row, data, "validation", {status:validation.status, fields:validation.issues.map(issue => issue.field), sampleCount:validation.accepted.length});
      if (validation.status === "REVISE" && data.revisions < 3) {
        data.revisions++;
        return ["REVISION_REQUIRED", `조사 담당에게 ${data.revisions}차 재작업을 요청했습니다.`, validation.issues];
      }
      if (validation.status === "PASS") return ["APPROVED", "상품과 시장 근거 검증을 마쳤습니다."];
      return [validation.status === "FAIL" ? "REJECTED" : "BLOCKED", "검증 보완 근거를 확인하세요.", validation.issues];
    }
    data.analysis = analyze(input, data.validation.accepted, row.channel, {returnCost:data.returnCost});
    const result = data.analysis.result;
    await note(row, data, "analysis", {price:result.reference, profit:result.profit, margin:result.margin, assessment:result.assessment});
    await note(row, data, "leader", {verified:true, profit:result.profit, assessment:result.assessment});
    if (result.profit === null) return ["BLOCKED", "시장 기준가 또는 적용 수수료를 확인하세요."];
    return ["COMPLETED", result.profit > 0 ? "추천 심사에 포함했습니다." : "예상 공헌이익이 0원 이하입니다."];
  }

  async function tick() {
    const row = claim();
    if (!row) return false;
    const data = JSON.parse(row.body);
    let outcome;
    try { outcome = await advance(row, data); }
    catch { outcome = ["FAILED", "작업 중 오류가 발생했습니다. 자료와 연결 설정을 확인하세요."]; }
    const [status, message, details] = outcome;
    data.reason = message;
    transaction(() => {
      if (!writeCandidate.run(status, JSON.stringify(data), row.id, row.lease).changes) return;
      event(row.run_id, row.id, row.role, status, message, details);
      if (row.role === "analysis") event(row.run_id, row.id, "leader", status, message);
    });
    return true;
  }

  function kick() {
    if (!schedule || stopped || pending) return;
    pending = Promise.resolve().then(async () => {
      while (!stopped && await tick()) { /* 단계별로 저장하고 다음 작업을 확인한다. */ }
    }).catch(() => {}).finally(() => { pending = null; });
  }

  const timer = schedule ? setInterval(kick, 1000) : null;
  timer?.unref();
  kick();

  function linkedEvidence(id, mode, channel, source, option) {
    const row = db.prepare(`SELECT c.body FROM orchestration_candidates c JOIN orchestration_runs r ON c.run_id=r.id
      WHERE c.id=? AND r.mode=? AND c.channel=? AND c.status='COMPLETED'`).get(id, mode, channel);
    if (!row) return null;
    const {input,validation} = JSON.parse(row.body);
    return input.source === source && input.option === option && validation?.status === "PASS" ? validation.supply : null;
  }

  function actuals(run) {
    return db.prepare(`SELECT c.id, v.channel, v.id AS version, date(o.updated,'+9 hours') AS date,
      COUNT(*) AS orderCount, SUM(o.received) AS settlement,
      SUM(o.received-o.cost-o.freight-COALESCE(o.loss,0)+COALESCE((SELECT SUM(recovery-expense) FROM order_returns WHERE order_id=o.id),0)) AS actualProfit,
      SUM(json_extract(v.body,'$.result.profit')*o.qty) AS forecastProfit
      FROM orchestration_candidates c JOIN versions v ON json_extract(v.body,'$.orchestrationCandidateId')=c.id
      JOIN listings l ON l.version=v.id JOIN order_lines o ON o.listing=l.id
      WHERE c.run_id=? AND v.mode=? AND o.received IS NOT NULL
      GROUP BY c.id,v.channel,v.id,date(o.updated,'+9 hours') ORDER BY date,c.id,v.id`).all(run.id,run.mode);
  }

  return {start, list, detail, supplement, tick, linkedEvidence,
    async workbook(id, mode) { return exportWorkbook(detail(id, mode)); },
    close() { stopped = true; clearInterval(timer); return pending; }
  };
}

module.exports = {orchestration};
