const categories = ["서랍 정리함", "서류 트레이", "책꽂이", "펜 정리대", "파일 케이스"];

function mockProducts(limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw Error("수집 수량은 1~1,000의 정수로 입력하세요.");
  const products = [];
  for (let i = 0; i < limit; i++) {
    if (i % 10 === 9) {
      products.push({...products[i - 1]});
      continue;
    }
    const code = "M" + String(i + 1).padStart(4, "0");
    products.push({
      code, name: categories[i % categories.length] + " " + code, option: "중형 1개",
      source: "https://fixture.invalid/products/" + code,
      cost: 3500 + (i % 24) * 150, freight: 3000,
      stock: i % 10 === 4 ? 0 : 20, minimum: i % 10 === 5 ? 3 : 1,
      direct: i % 10 !== 6, rights: i % 10 === 7 ? null : true,
      resale: true
    });
  }
  return products;
}

function screen(products) {
  const seen = new Set();
  let selected = 0;
  const counts = {"조사 대상":0,"순번 대기":0,"중복":0,"제외":0,"보완":0};
  const rows = [...products].sort((a,b)=>a.code.localeCompare(b.code)).map(product => {
    const key = JSON.stringify([product.source, product.option.trim()]);
    let status, reason;
    if (seen.has(key)) { status="중복"; reason="같은 공급 상품과 옵션"; }
    else if (product.stock === 0 || product.minimum > 1 || product.direct === false || product.resale === false || product.rights === false) {
      status="제외";
      reason=[product.stock===0 && "품절",product.minimum>1 && "묶음 주문 필수",product.direct===false && "직배송 불가",product.resale===false && "재판매 불가",product.rights===false && "이미지 사용 불가"].filter(Boolean).join(", ");
    } else if ([product.cost,product.freight,product.stock,product.minimum,product.direct,product.rights,product.resale].some(value=>value==null) || !product.option.trim()) {
      status="보완"; reason="비용·규격 또는 공급 조건 근거 미확인";
    } else if (selected < 10) {
      selected++; status="조사 대상"; reason="공급 조건 확인 · 상품번호순";
    } else { status="순번 대기"; reason="이번 회차 조사 대상 10개 선정 완료"; }
    seen.add(key);
    counts[status]++;
    return {...product,status,reason};
  });
  return {counts,rows};
}
function supplierProducts(items){
  if(!Array.isArray(items)||!items.length||items.length>1000)throw Error("공급 상품 배열 1~1,000개를 선택하세요.");
  return items.map(item=>{
    const row={};
    for(const key of ["code","name","option","source","maker","model","keywords"]){
      row[key]=typeof item?.[key]==="string"?item[key].trim():"";
    }
    if(!row.code||!row.name||!/^https?:\/\//.test(row.source)||new URL(row.source).hostname==="fixture.invalid")throw Error("실제 공급 상품번호·상품명·출처가 필요합니다.");
    row.source=new URL(row.source).href;
    for(const key of ["cost","freight","stock","minimum"])row[key]=/^\d{1,9}$/.test(String(item[key]))?Number(item[key]):null;
    for(const key of ["direct","rights","resale"])row[key]=typeof item[key]==="boolean"?item[key]:null;
    return row;
  });
}
module.exports={mockProducts,screen,supplierProducts};
