"use strict";

const {evaluate, feeEstimate} = require("./market");
const MAX_PRICE = 999_999_999;
const PRICE_DROP_PERCENT = 5;
const FREIGHT_INCREASE = 1000;
const roundUp = (price, unit) => Math.ceil(price / unit) * unit;

function analyze(input, samples, channel, {returnCost} = {}) {
  const result = evaluate(input, samples, channel);
  const shipping = Number(input.shipping);
  const cost = Number(input.cost);
  const floor = Number(input.floor || 0);
  const unit = channel === "G마켓" ? 10 : 1;
  const minimumPrice = roundUp(Math.max(1, floor), unit);
  const baseFreight = result.appliedFreight;
  const reference = result.reference;
  const returnConfirmed = Number.isSafeInteger(returnCost) && returnCost >= 0 && returnCost <= MAX_PRICE;
  const min = result.prices[0] ?? null;
  const max = result.prices.at(-1) ?? null;
  const buyerTotal = reference === null ? null : reference + shipping;

  function scenario(key, label, price, freight, extra = 0, missingReason = "") {
    const fee = price === null ? null : feeEstimate(channel, input, price, shipping).fee;
    const revenue = price === null ? null : price + shipping;
    const profit = fee === null || extra === null ? null : revenue - cost - freight - fee - extra;
    return {key, label, price, shipping, cost, freight, fee, extra, profit,
      margin: profit === null ? null : profit * 100 / revenue,
      reason: missingReason || (price === null ? "채택한 시장 표본이 없습니다." : fee === null ? result.policy.label : "")};
  }

  let breakEven = null;
  if (result.policy.fee !== null) {
    let price = roundUp(Math.max(minimumPrice, cost + baseFreight - shipping), unit);
    while (price <= MAX_PRICE) {
      const {profit} = scenario("", "", price, baseFreight);
      if (profit >= 0) { breakEven = price; break; }
      // 수수료가 감소하지 않으므로 손실액 미만의 인상으로는 흑자가 될 수 없다.
      price += roundUp(-profit, unit);
    }
  }

  const reduced = reference === null ? null : Math.max(minimumPrice,
    Math.floor(reference * (100 - PRICE_DROP_PERCENT) / (100 * unit)) * unit);
  return {
    version: 1, result, breakEven,
    breakEvenReason: breakEven === null ? (result.policy.fee === null ? result.policy.label : "지원하는 판매가 범위에서 손익분기에 도달하지 못했습니다.") : "",
    distribution: {count: result.prices.length, min, median: result.median, max, buyerTotal,
      versusMin: min === null || buyerTotal === null ? null : buyerTotal - min,
      versusMinPercent: !min || buyerTotal === null ? null : (buyerTotal - min) * 100 / min},
    scenarios: [
      scenario("baseline", "시장 기준가", reference, baseFreight),
      scenario("price_drop", "판매가 5% 인하", reduced, baseFreight, 0,
        reduced !== null && reduced === reference ? "공급처 최저가 또는 채널 최소가가 적용됩니다." : ""),
      scenario("freight_increase", "공급 배송비 1,000원 증가", reference, baseFreight + FREIGHT_INCREASE),
      scenario("return_cost", "반품 실비 반영", reference, baseFreight, returnConfirmed ? returnCost : null,
        returnConfirmed ? "" : "확인된 반품 실비가 없습니다.")
    ]
  };
}

function rank(candidates) {
  const ranks = new Map();
  return candidates.filter(candidate => {
    const validation = candidate.validation?.status ?? candidate.validation?.result ?? candidate.validation?.outcome ?? candidate.status;
    return validation === "PASS" && [undefined,"PASS","COMPLETED"].includes(candidate.status) && candidate.analysis?.result?.profit > 0;
  }).sort((a, b) => {
    const resultA = a.analysis.result;
    const resultB = b.analysis.result;
    return a.channel.localeCompare(b.channel, "ko") ||
      (resultB.assessment.total ?? -1) - (resultA.assessment.total ?? -1) ||
      resultB.margin - resultA.margin || resultB.profit - resultA.profit ||
      String(a.id).localeCompare(String(b.id), "ko", {numeric: true});
  }).map(candidate => {
    const position = (ranks.get(candidate.channel) ?? 0) + 1;
    ranks.set(candidate.channel, position);
    return {...candidate, rank: position};
  });
}

module.exports = {analyze, rank, exportWorkbook: require("./orchestration-workbook").exportWorkbook};
