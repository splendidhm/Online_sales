/* 원 단위 정수와 1bp(0.01%) 단위 요율을 사용한다. */
function amount(value) {
  if (!/^\d{1,9}$/.test(String(value))) throw Error("금액은 0 이상 9자리 이하 정수로 입력하세요.");
  return Number(value);
}

function rate(value) {
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(String(value))) throw Error("요율은 0~99.99% 범위로 입력하세요.");
  return Math.round(Number(value) * 100);
}

function evaluate(input, samples) {
  const fixed = ["cost","freight","packing","ads","returns"].reduce((sum,key) => sum + amount(input[key]), 0);
  const shipping = amount(input.shipping), discount = amount(input.discount);
  const revenue = amount(input.price) + shipping - discount;
  const feeRate = rate(input.fee), target = rate(input.target);
  if (revenue <= 0) throw Error("할인 후 주문 수익이 0원 이하입니다.");
  if (feeRate + target >= 10000) throw Error("수수료와 목표 이익률의 합은 100% 미만이어야 합니다.");
  const fee = r => Math.ceil(r * feeRate / 10000);
  const profit = revenue - fixed - fee(revenue);
  let minRevenue = Math.max(1, Math.ceil(fixed * 10000 / (10000 - feeRate - target)));
  if (minRevenue > 1999999998) throw Error("목표 이익률에 필요한 가격이 입력 범위를 초과합니다.");
  while ((minRevenue - fixed - fee(minRevenue)) * 10000 < target * minRevenue) minRevenue++;
  let minimum = Math.max(0, amount(input.floor), minRevenue - shipping + discount);
  // 판매준수가격을 적용한 위치에서도 원 단위 수수료 올림을 다시 검사한다.
  while ((minimum + shipping - discount - fixed - fee(minimum + shipping - discount)) * 10000 < target * (minimum + shipping - discount)) minimum++;
  const sellers = new Set(), links = new Set(), prices = [];
  for (const sample of [...samples].sort((a,b) => b.time.localeCompare(a.time))) {
    const seller = sample.seller.trim().toLowerCase();
    if (!sample.match || !seller || sellers.has(seller) || links.has(sample.url)) continue;
    prices.push(amount(sample.price) + amount(sample.shipping));
    sellers.add(seller); links.add(sample.url);
    if (prices.length === 5) break;
  }
  prices.sort((a,b) => a-b);
  const reference = prices.length === 5 ? prices[2] - shipping + discount : null;
  const competitiveCount = prices.filter(p => p <= minimum + shipping - discount).length;
  const referenceRevenue = reference === null ? 0 : reference + shipping - discount;
  const viable = reference !== null && reference >= minimum && referenceRevenue > 0 &&
    (referenceRevenue - fixed - fee(referenceRevenue)) * 10000 >= referenceRevenue * target;
  return {profit, margin: profit * 100 / revenue, fee: fee(revenue), minimum, prices, reference, viable, competitiveCount};
}
if (typeof module !== "undefined") module.exports = {evaluate};
