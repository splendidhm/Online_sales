"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {Workbook} = require("exceljs");
const {analyze, rank, exportWorkbook} = require("./orchestration-finance");
const {feeEstimate} = require("./market");

const input = {
  name:"정리함", option:"중형 1개", maker:"연습회사", model:"M1", keywords:"정리함 중형",
  shipping:0, cost:5000, freight:3000, grade:"일반", category:"수납/정리용품"
};
const samples = [10900, 12000, 12500].map((price, index) => ({
  title:input.name, option:input.option, maker:input.maker, model:input.model, quantity:1,
  match:true, price, shipping:0, seller:"연습판매처"+index, url:`https://fixture.invalid/products/${index}`,
  time:"2026-11-20T12:30", grade:"A", verification:"PASS", total:price
}));

test("기존 수수료를 재사용하고 손익분기·공급 배송비·반품 비용을 검산한다", () => {
  const a = analyze(input, samples, "네이버", {returnCost:2000});
  assert.equal(a.result.reference, 12000);
  assert.deepEqual(a.distribution, {count:3,min:10900,median:12000,max:12500,buyerTotal:12000,versusMin:1100,versusMinPercent:1100*100/10900});
  assert.equal(a.scenarios[0].profit, a.result.profit);
  assert.equal(a.scenarios[1].price, 11400);
  assert.equal(a.scenarios[2].profit, a.result.profit - 1000);
  assert.equal(a.scenarios[3].profit, a.result.profit - 2000);
  const profit = price => price - 8000 - feeEstimate("네이버", input, price, 0).fee;
  assert.ok(profit(a.breakEven) >= 0);
  for (let price = 8000; price < a.breakEven; price++) assert.ok(profit(price) < 0);

  const gmarket = analyze({...input, floor:11701, gmarketCategory:"생활용품"}, samples, "G마켓");
  assert.equal(gmarket.scenarios[1].price, 11710);
  assert.equal(gmarket.breakEven, 11710);
  assert.equal(gmarket.scenarios[3].profit, null);
  const unsupported = analyze({...input, category:"신발"}, samples, "쿠팡");
  assert.equal(unsupported.breakEven, null);
  assert.equal(unsupported.result.profit, null);
  assert.match(unsupported.breakEvenReason, /확인 필요/);
});

test("양의 수익과 검증 통과가 모두 충족된 후보만 채널별로 순위를 매긴다", () => {
  const analysis = analyze(input, samples, "네이버");
  const candidates = [
    {id:2,channel:"네이버",validation:{status:"PASS"},analysis},
    {id:1,channel:"네이버",validation:{status:"PASS"},analysis},
    {id:3,channel:"네이버",validation:{status:"UNVERIFIED"},analysis},
    {id:4,channel:"쿠팡",validation:{status:"PASS"},analysis:analyze(input, samples, "쿠팡")},
    {id:5,channel:"네이버",validation:{status:"PASS"},analysis:analyze({...input, cost:13000}, samples, "네이버")}
  ];
  assert.deepEqual(rank(candidates).map(row => [row.id,row.rank]), [[1,1],[2,2],[4,1]]);
});

test("Excel 여덟 시트에 숫자·출처·가정을 남기고 공급 문구를 텍스트로 연다", async () => {
  const candidate = {id:1, channel:"네이버", status:"COMPLETED", input:{...input,name:"=1+2"},
    validation:{status:"PASS",samples,supply:{source:"https://fixture.invalid/supply?item=10&token=hidden",time:"2026-11-20T12:30"}},
    analysis:analyze(input, samples, "네이버")};
  const bytes = await exportWorkbook({id:4,mode:"fixture",status:"COMPLETED",created:"2026-11-20T03:30:00Z",candidates:[candidate],ranking:rank([candidate])});
  const reopened = new Workbook();
  await reopened.xlsx.load(bytes);
  assert.deepEqual(reopened.worksheets.map(sheet => sheet.name), ["요약","상품 후보","시장조사","검증 결과","수익성 분석","추천 순위","출처","가정"]);
  assert.equal(reopened.getWorksheet("요약").getCell("B5").value, "2026-11-20 12:30:00");
  assert.equal(reopened.getWorksheet("상품 후보").getCell("B2").value, "=1+2");
  const sheet = reopened.getWorksheet("수익성 분석");
  assert.equal(sheet.getCell("L2").value, candidate.analysis.result.profit);
  assert.equal(sheet.getCell("M2").numFmt, "0.0%");
  assert.equal(sheet.getCell("L5").value, null);
  assert.equal(reopened.getWorksheet("출처").getCell("E2").value, "https://fixture.invalid/supply?item=10");
});
