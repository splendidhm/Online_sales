"use strict";

const { classify } = require("./market");
const { research } = require("./research");

const clean = value => String(value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
const identified = value => Boolean(clean(value)) && !/^(?:없음|미확인|미상|해당없음|기타|unknown|n\/?a|-)$/i.test(clean(value));
const safeText = (value, max = 240) => typeof value === "string" ? value.trim().slice(0, max) : "";
const money = value => /^\d{1,9}$/.test(String(value)) ? Number(value) : null;
const count = value => money(value) > 0 ? money(value) : null;

function sourceUrl(value, mode) {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password ||
        (url.hostname === "fixture.invalid") !== (mode === "fixture")) return "";
    for (const key of url.searchParams.keys()) {
      if (/token|secret|password|session|signature|credential|auth|key/i.test(key)) return "";
    }
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function observationTime(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return "";
  const date = new Date(value + ":00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 16) === value ? value : "";
}

function optionQuantity(value, option) {
  const matches = [...String(option ?? "").normalize("NFKC").matchAll(/(?:^|[\s(])(\d+)\s*(?:개입|개|켤레|세트)(?=$|[\s)])/g)];
  const guess = matches.length === 1 ? count(matches[0][1]) : null;
  if (value == null || value === "") return guess;
  const explicit = count(value);
  return guess !== null && guess !== explicit ? null : explicit;
}

function evidenceIssue(field, value, reason, required, source = "") {
  return {field, value: value ?? null, reason, required, source};
}

function normalizeSample(raw, input, mode, method) {
  const url = sourceUrl(raw?.url, mode);
  const sample = {
    title: safeText(raw?.title), maker: identified(raw?.maker) ? safeText(raw.maker) : "",
    model: identified(raw?.model) ? safeText(raw.model) : "",
    option: safeText(raw?.option), seller: safeText(raw?.seller), url,
    time: observationTime(raw?.time), price: money(raw?.price), shipping: money(raw?.shipping),
    regularPrice: money(raw?.regularPrice), promoPrice: money(raw?.promoPrice),
    condition: safeText(raw?.condition), quantity: optionQuantity(raw?.quantity, raw?.option),
    reviews: money(raw?.reviews), match: raw?.match === true, method,
    confirmed: method === "manual" && raw?.confirmed === true
  };
  const activePromotion = sample.promoPrice !== null && sample.price === sample.promoPrice;
  sample.priceComparable = raw?.offerType === "unconditional" ||
    (!sample.condition && !activePromotion && (!raw?.offerType || raw.offerType === "regular"));
  sample.total = sample.price === null || sample.shipping === null ? null : sample.price + sample.shipping;
  sample.grade = comparisonGrade(input, sample);
  return sample;
}

function comparisonGrade(input, sample) {
  const sameModel = identified(input.maker) && identified(input.model) &&
    clean(input.maker) === clean(sample.maker) && clean(input.model) === clean(sample.model);
  const units = optionQuantity(input.quantity, input.option);
  if (sameModel) {
    if (units === null || sample.quantity === null || !clean(input.option) || !clean(sample.option)) return "D";
    return units === sample.quantity && clean(input.option) === clean(sample.option) ? "A" : "B";
  }
  return sample.reviews !== null && units !== null && units === sample.quantity &&
    classify(input, sample) === "유사" ? "C" : "D";
}

function fixtureSamples(candidate, input, channel) {
  const name = input.name || candidate.name || "연습 상품";
  const id = encodeURIComponent(candidate.code || name);
  const tag = channel === "네이버" ? "naver" : "coupang";
  const unit = optionQuantity(input.quantity, input.option);
  return [11000, 11600, 12100, 12600, 13000, 13200, 13500, 13800, 14000, 14300].slice(0, input.top === 10 ? 10 : 5).map((price, index) => ({
    title: name + " " + (input.keywords || name), maker: input.maker, model: input.model,
    option: input.option, quantity: unit, seller: "연습 판매처 " + (index + 1),
    url: "https://fixture.invalid/market/" + tag + "/" + id + "/" + index,
    time: "2026-11-20T09:00", price, regularPrice: price, shipping: 0,
    reviews: 30 + index, match: true, offerType: "regular"
  }));
}

async function investigate({candidate, input, channel, mode, manualSamples = []}, dependencies = {}) {
  const source = mode === "fixture" ? "fixture" : manualSamples.length ? "manual" : "provider";
  const raw = source === "fixture" ? fixtureSamples(candidate, input, channel) :
    source === "manual" ? manualSamples : await (dependencies.research ?? research)({input, channel});
  if (!Array.isArray(raw)) throw Error("시장조사 표본 형식을 확인하세요.");
  const samples = raw.slice(0, 200).map(row => normalizeSample(row, input, mode, source));
  return {samples, source, issues: []};
}

function supplyIssues(candidate, input, mode, confirmation) {
  const source = sourceUrl(candidate.source, mode);
  const missing = [];
  const conflicts = [];
  const failures = [];
  const add = (target, field, value, reason, required) =>
    target.push(evidenceIssue(field, value, reason, required, source));
  if (!source) add(missing, "source", "", "공급 출처가 없거나 자료 종류와 다릅니다.", "상품 원본 링크");
  for (const [key, label] of [["cost", "공급가"], ["freight", "공급 배송비"], ["stock", "공급 재고"], ["minimum", "최소 주문 수량"]]) {
    const observed = money(candidate[key]);
    if (observed === null) add(missing, key, null, label + " 근거가 없습니다.", label + " 원본 확인");
    else if ((key === "stock" && observed === 0) || (key === "minimum" && observed !== 1)) {
      add(failures, key, observed, label + "이 1개 직배송 조건에 맞지 않습니다.", label + " 조건 충족");
    } else if ((key === "cost" || key === "freight") && observed !== money(input[key])) {
      add(conflicts, key, money(input[key]), label + "이 공급 관측값과 다릅니다.", label + " " + observed + "원으로 확인");
    }
  }
  for (const [key, label] of [["direct", "직배송"], ["rights", "이미지 사용"], ["resale", "재판매"]]) {
    if (candidate[key] === false) add(failures, key, false, label + " 불가가 확인되었습니다.", label + " 가능 상품");
    else if (candidate[key] !== true) add(missing, key, null, label + " 조건이 미확인입니다.", label + " 근거 확인");
  }
  if (!clean(candidate.option) || optionQuantity(input.quantity, input.option) === null) {
    add(missing, "option", safeText(input.option), "구성 수량을 확인할 수 없습니다.", "옵션과 구성 수량");
  } else if (clean(candidate.option) !== clean(input.option)) {
    add(conflicts, "option", safeText(input.option), "조사 옵션이 공급 옵션과 다릅니다.", "공급 옵션과 대조");
  }
  if (mode !== "fixture") {
    if (confirmation?.verified !== true || !source || sourceUrl(confirmation.source, mode) !== source || !observationTime(confirmation.time)) {
      add(missing, "supplyConfirmation", null, "공급 조건을 원본과 대조한 기록이 없습니다.", "공급 링크와 확인 시각");
    }
    for (const [key, label] of [["origin", "원산지"], ["disclosure", "상품고시"], ["certification", "필수 인증"], ["rights", "이미지 권리"]]) {
      const value = safeText(confirmation?.[key], 500);
      if (!value || /미확인|확인\s*필요|상세\s*(?:설명|페이지)\s*참조/.test(value)) {
        add(missing, key, value, label + "의 구체적인 확인 근거가 없습니다.", label + " 근거 또는 해당 없음 사유");
      }
    }
  }
  return {source, failures, conflicts, missing};
}

function sampleKey(sample) {
  return JSON.stringify([sample.url, clean(sample.seller), clean(sample.title), clean(sample.maker),
    clean(sample.model), clean(sample.option), sample.quantity, sample.price, sample.shipping, sample.grade]);
}

function comparable(sample) {
  return ["A", "C"].includes(sample.grade) && sample.match && sample.title && sample.seller &&
    sample.url && sample.time && sample.total !== null && sample.price > 0 && sample.priceComparable;
}

function acceptedSamples(samples) {
  const newest = new Map();
  for (const sample of [...samples].sort((left, right) => right.time.localeCompare(left.time))) {
    if (!newest.has(sample.url)) newest.set(sample.url, sample);
  }
  const distinct = new Map();
  for (const sample of newest.values()) {
    if (sample.verification !== "PASS") continue;
    const key = JSON.stringify([sample.grade, clean(sample.seller)]);
    if (!distinct.has(key) || sample.total < distinct.get(key).total) distinct.set(key, sample);
  }
  return [...distinct.values()];
}

async function validateEvidence({candidate, input, channel, mode, investigation, supplyConfirmation}, dependencies = {}) {
  const {source, failures, conflicts, missing} = supplyIssues(candidate, input, mode, supplyConfirmation);
  const candidates = investigation.samples;
  let observed = new Map();
  if (investigation.source === "provider" && candidates.some(comparable) && !failures.length && !missing.length) {
    const rows = await (dependencies.reobserve ?? dependencies.research ?? research)({input, channel});
    if (!Array.isArray(rows)) throw Error("시장 표본의 재확인 응답 형식을 확인하세요.");
    const comparableRows = rows.slice(0, 200).map(row => normalizeSample(row, input, mode, "provider"))
      .filter(comparable).sort((left, right) => left.time.localeCompare(right.time));
    observed = new Map(comparableRows.map(sample => [sampleKey(sample), sample.time]));
  }
  const samples = candidates.map(sample => {
    if (!comparable(sample)) return {...sample, verification: "EXCLUDED", verificationReason: "구성·가격·배송 조건을 비교할 수 없는 표본"};
    const observedAt = observed.get(sampleKey(sample));
    if (sample.method === "fixture" || sample.confirmed || observedAt) {
      return {...sample, verification: "PASS", verifiedAt: observedAt ?? sample.time,
        verificationReason: sample.method === "fixture" ? "연습 표본" :
        sample.confirmed ? "대표자가 판매 페이지 직접 확인" : "허가된 검색 출처에서 가격·구성 재확인"};
    }
    return {...sample, verification: "UNVERIFIED", verificationReason: "판매 페이지 확인 또는 같은 조건의 재조회 근거 필요"};
  });
  const accepted = acceptedSamples(samples);
  if (!accepted.length && !failures.length && !conflicts.length) {
    const unconfirmed = samples.find(sample => sample.verification === "UNVERIFIED");
    const target = unconfirmed && investigation.source === "provider" && !missing.length ? conflicts : missing;
    target.push(evidenceIssue("samples", unconfirmed?.price, unconfirmed?.verificationReason ?? "비교 가능한 시장 표본이 없습니다.",
      "동일 상품 또는 유사 상품의 출처·구성·배송 포함 가격 확인", unconfirmed?.url ?? source));
  }
  const status = failures.length ? "FAIL" : missing.length ? "UNVERIFIED" : conflicts.length ? "REVISE" : "PASS";
  return {status, issues: [...failures, ...conflicts, ...missing], samples, accepted,
    supply: {source, time: mode === "fixture" ? "2026-11-20T09:00" : observationTime(supplyConfirmation?.time),
      origin: safeText(supplyConfirmation?.origin, 500), disclosure: safeText(supplyConfirmation?.disclosure, 500),
      certification: safeText(supplyConfirmation?.certification, 500), rights: safeText(supplyConfirmation?.rights, 500)}};
}

module.exports = {investigate, validateEvidence};
