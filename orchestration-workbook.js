"use strict";

const {Workbook} = require("exceljs");

const KRW = '#,##0"원"';
const PERCENT = '0.0%';
const labels = {fixture:"연습",manual:"실상품", PENDING:"대기",RUNNING:"진행 중",VALIDATING:"검증 중",
  REVISION_REQUIRED:"보완 요청",APPROVED:"승인",REJECTED:"제외",BLOCKED:"보완 대기",COMPLETED:"완료",
  FAILED:"실패",PASS:"통과",REVISE:"재작업",FAIL:"부적격",UNVERIFIED:"미확인",EXCLUDED:"제외"};
const roles = {research:"조사 담당", validation:"검증 담당", analysis:"데이터 분석 담당", leader:"팀 리더"};
const label = key => labels[key] ?? key;
const pct = value => typeof value === "number" ? value / 100 : null;
const dateFormatter = new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Seoul", dateStyle:"short", timeStyle:"medium"});

function seoulTime(value) {
  if (typeof value !== "string") return null;
  // 표본의 오프셋 없는 시각은 조사 계약상 한국시간이다.
  const source = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(" ", "T") + "Z" : value;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(source)) return source.replace("T", " ");
  const date = new Date(source);
  return Number.isFinite(date.getTime()) ? dateFormatter.format(date) : null;
}

function publicSource(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(key|api.?key|access.?key|token|access.?token|secret|signature|password|credential|authorization|x-amz-.+)$/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return null;
  }
}

function primitive(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return value.slice(0, 32767);
  if (typeof value === "boolean") return value ? "확인" : "아니요";
  return null;
}

function addTable(sheet, titles, rows, formats = {}, options = {}) {
  const headerRow = sheet.addRow(titles);
  headerRow.height = 28;
  headerRow.eachCell(cell => {
    cell.font = {name:"Arial", size:10, bold:true, color:{argb:"FFFFFFFF"}};
    cell.fill = {type:"pattern", pattern:"solid", fgColor:{argb:"FF263E36"}};
    cell.alignment = {vertical:"middle", horizontal:"center", wrapText:true};
  });
  const displayLength = value => [...String(value ?? "")].reduce((width, char) => width + (char.codePointAt(0)>127 ? 2 : 1), 0);
  const widths = titles.map((title, index) => Math.min(70, Math.max(13, displayLength(title)+4,
    ...rows.map(values => displayLength(primitive(values[index])) + 3))));
  for (const [index, width] of widths.entries()) {
    const column = sheet.getColumn(index+1);
    column.width = Math.max(column.width ?? 0, width);
  }
  for (const values of rows) {
    const row = sheet.addRow(values.map(primitive));
    let lines = 1;
    row.eachCell((cell, columnIndex) => {
      const width = sheet.getColumn(columnIndex).width;
      const long = typeof cell.value === "string" && (displayLength(cell.value) > width-2 || cell.value.includes("\n"));
      if (long) lines = Math.max(lines, cell.value.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(displayLength(line) / (width-2))), 0));
      cell.font = {name:"Arial", size:10};
      cell.alignment = {vertical:"middle", wrapText:long};
      if (formats[columnIndex]) cell.numFmt = formats[columnIndex];
    });
    row.height = Math.min(150, 16 * lines + 3);
  }
  if (options.filter && rows.length) sheet.autoFilter = {from:{row:headerRow.number,column:1},to:{row:headerRow.number+rows.length,column:titles.length}};
}

async function exportWorkbook(run) {
  const book = new Workbook();
  book.creator = "코뉴의 발견";
  const view = {showGridLines:false};
  const addSheet = (name, freeze = true) => book.addWorksheet(name, {views:[freeze ? {...view,state:"frozen",ySplit:1} : view]});
  const candidates = run.candidates ?? [];
  const ranking = run.ranking ?? [];
  const summary = addSheet("요약", false);
  summary.properties.tabColor = {argb:"FF263E36"};
  addTable(summary, ["항목", "내용"], [
    ["분석 회차", run.id], ["자료 종류", label(run.mode)], ["상태", label(run.status)],
    ["생성 시각 (한국시간)", seoulTime(run.created)], ["완료 시각 (한국시간)", seoulTime(run.completed ?? run.updated)],
    ["후보 수", candidates.length], ["추천 건수", ranking.length],
    ["분석 기준", "현재 저장된 분석 결과"],
    ["업로드 결과", "게시 후 기존 판매 운영에서 확인"],
    ["실판매 비교", run.actuals?.length ? "아래 대조 내역 참조" : "연결된 실적 자료가 없습니다."]
  ]);
  if (run.actuals?.length) {
    summary.addRow([]);
    addTable(summary, ["후보", "마켓", "승인 버전", "실적 기간", "주문 수", "정산 금액", "예상 공헌이익", "실제 공헌이익", "차이"], run.actuals.map(row => {
      const gap = Number.isFinite(row.actualProfit) && Number.isFinite(row.forecastProfit) ? row.actualProfit - row.forecastProfit : null;
      return [row.id, row.channel, row.version, row.date, row.orderCount, row.settlement, row.forecastProfit, row.actualProfit, gap];
    }), {6:KRW,7:KRW,8:KRW,9:KRW});
  }

  const listingSheet = addSheet("상품 후보");
  addTable(listingSheet, ["후보", "상품명", "마켓", "옵션", "상태", "공급가", "공급 배송비", "재고", "근거 충족률", "경쟁강도", "보완 사유"], candidates.map(candidate => {
    const input = candidate.input ?? candidate.product ?? {};
    const result = candidate.analysis?.result;
    return [candidate.id, input.name, candidate.channel, input.option, label(candidate.status), input.cost, input.freight,
      input.stock ?? candidate.product?.stock, pct(result?.assessment?.coverage), result?.assessment?.strength, candidate.reason];
  }), {6:KRW,7:KRW,9:PERCENT}, {filter:true});

  const marketSheet = addSheet("시장조사");
  const marketRows = candidates.flatMap(candidate => {
    const adopted = new Set(candidate.analysis?.result?.selected ?? []);
    const accepted = new Map((candidate.validation?.accepted ?? []).map(sample => [sample.url, sample]));
    const written = new Set();
    return (candidate.validation?.samples ?? candidate.samples ?? []).map(sample => {
      const match = accepted.get(sample.url) ?? sample;
      const selected = adopted.has(sample.url) && !written.has(sample.url) && sample.verification === "PASS" &&
        sample.time === match.time && sample.seller === match.seller && sample.total === match.total;
      if (selected) written.add(sample.url);
      return [candidate.id, candidate.channel, sample.title, sample.maker, sample.model, sample.seller, sample.option, sample.quantity,
        sample.regularPrice, sample.promoPrice, sample.price, sample.shipping, sample.total, sample.reviews, sample.condition, sample.grade,
        label(sample.verification), selected ? "채택" : "미채택", sample.verificationReason, seoulTime(sample.time), publicSource(sample.url)];
    });
  });
  addTable(marketSheet, ["후보", "마켓", "표본명", "제조사", "모델", "판매처", "옵션", "구성 수량", "정상가", "행사가", "비교 판매가", "배송비", "배송 포함가",
    "리뷰 수", "행사 조건", "비교 등급", "검증 상태", "가격 반영", "검증 근거", "조회 시각 (한국시간)", "출처"], marketRows,
    {9:KRW,10:KRW,11:KRW,12:KRW,13:KRW}, {filter:true});

  const validationSheet = addSheet("검증 결과");
  const validationRows = candidates.flatMap(candidate => {
    const validation = candidate.validation ?? {};
    const issues = validation.issues?.length ? validation.issues : [{}];
    return issues.map(issue => [candidate.id, candidate.channel, label(validation.status ?? candidate.status), issue.field, issue.value,
      issue.reason ?? candidate.reason, issue.required, publicSource(issue.source)]);
  });
  addTable(validationSheet, ["후보", "마켓", "검증 결과", "확인 항목", "기존 값", "발견 사항", "필요한 보완", "출처"], validationRows, {}, {filter:true});
  const history = (run.events ?? []).map(event => [event.candidateId, roles[event.role], label(event.status), event.message, seoulTime(event.created)]);
  if (history.length) {
    validationSheet.addRow([]);
    addTable(validationSheet, ["후보", "담당", "작업 상태", "이력", "기록 시각 (한국시간)"], history);
  }

  const financeSheet = addSheet("수익성 분석");
  const financeRows = candidates.flatMap(candidate => {
    const {analysis} = candidate;
    if (!analysis) return [[candidate.id, candidate.channel, null, null, null, null, null, null, null, null, null, null, null,
      null, null, null, null, null, null, null, candidate.reason ?? "계산 대기"]];
    const {distribution, result} = analysis;
    return analysis.scenarios.map(scenario => [candidate.id, candidate.channel, result.version, analysis.version, scenario.label,
      scenario.price, scenario.shipping, scenario.cost, scenario.freight, scenario.fee, scenario.extra, scenario.profit, pct(scenario.margin), analysis.breakEven,
      distribution.count, distribution.min, distribution.median, distribution.max, distribution.versusMin, pct(distribution.versusMinPercent), scenario.reason || analysis.breakEvenReason]);
  });
  addTable(financeSheet, ["후보", "마켓", "계산 기준 버전", "분석 버전", "시나리오", "판매가", "구매자 배송비", "공급가", "공급 배송비", "수수료", "별도 직접비",
    "공헌이익", "공헌이익률", "손익분기 판매가", "채택 표본 수", "시장 최저가", "시장 중앙값", "시장 최고가", "최저가 차이", "최저가 대비", "미확인 사유"],
    financeRows, {6:KRW,7:KRW,8:KRW,9:KRW,10:KRW,11:KRW,12:KRW,13:PERCENT,14:KRW,16:KRW,17:KRW,18:KRW,19:KRW,20:PERCENT}, {filter:true});

  const rankSheet = addSheet("추천 순위");
  addTable(rankSheet, ["마켓", "순위", "후보", "상품명", "종합점수", "근거 충족률", "예상 공헌이익", "예상 이익률", "추천 근거"], ranking.map(entry => {
    const candidate = candidates.find(item => item.id === entry.id && item.channel === entry.channel) ?? entry;
    const result = candidate.analysis?.result;
    return [candidate.channel, entry.rank, candidate.id, (candidate.input ?? candidate.product)?.name, result?.assessment?.total,
      pct(result?.assessment?.coverage), result?.profit, pct(result?.margin), candidate.recommendation ??
      (result?.assessment?.total == null ? "검증 통과 · 양의 이익 · 종합점수 근거 부족" : "검증 통과 · 양의 이익 · 기존 종합점수 반영")];
  }), {6:PERCENT,7:KRW,8:PERCENT}, {filter:true});

  const sourceSheet = addSheet("출처");
  const sourceRows = candidates.flatMap(candidate => {
    const supply = candidate.validation?.supply;
    const policy = candidate.analysis?.result?.policy;
    const samples = candidate.validation?.samples ?? candidate.samples ?? [];
    return [[candidate.id, candidate.channel, "공급 정보", seoulTime(supply?.time), publicSource(supply?.source ?? candidate.input?.source ?? candidate.product?.source)],
      ...samples.map(sample => [candidate.id, candidate.channel, "시장 표본", seoulTime(sample.time), publicSource(sample.url)]),
      [candidate.id, candidate.channel, "수수료 정책", policy?.checked, publicSource(policy?.source)]];
  });
  addTable(sourceSheet, ["후보", "마켓", "자료 구분", "확인 시각 (한국시간)", "출처"], sourceRows.filter(row => row[4]), {}, {filter:true});

  const assumptionSheet = addSheet("가정");
  addTable(assumptionSheet, ["산정 항목", "적용 기준"], [
    ["가격 선정", "검증된 동일 구성 우선 · 유사 상품은 리뷰 상위 5개 또는 10개"],
    ["시장가격", "동일 관측 조건의 배송 포함가 · 채택 표본 중앙값"],
    ["예상 공헌이익", "판매가 + 구매자 배송비 − 공급가 − 공급 배송비 − 해당 채널 수수료"],
    ["예상 이익률", "예상 공헌이익 ÷ 구매자 배송비 포함 수입"],
    ["가격 인하", "상품가 5% 인하 · 채널 단위에 맞추고 공급처 하한을 적용"],
    ["공급 배송비 증가", "기준 주문당 공급 배송비에 1,000원 추가"],
    ["반품 시나리오", "입력 근거가 있는 반품비를 기준 공헌이익에서 차감"],
    ["수수료·검증 미확인", "누락 비용이 있는 항목은 공란과 사유 표시"],
    ["추천 순서", "채널별로 종합점수, 예상 이익률, 공헌이익, 후보 식별자로 정렬"]
  ]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

module.exports = {exportWorkbook};
