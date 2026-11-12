async function research({input,channel}, endpoint=process.env.ACC_RESEARCH_URL, request=fetch){
  if(!endpoint)throw Error("허가받은 상품 검색 공급처가 연결되지 않았습니다. 검색 링크로 조회한 표본을 입력할 수 있습니다.");
  if(!["네이버","쿠팡"].includes(channel))throw Error("마켓을 확인하세요.");
  const queries=[
    ["exact",[input.maker,input.model,input.option].every(Boolean)?[input.maker,input.model,input.option].join(" "):""],
    ["similar",input.keywords]
  ].filter(([,q])=>q?.trim());
  if(!queries.length)throw Error("제조사·모델·구성 또는 유사 검색어를 입력하세요.");
  const pages=await Promise.all(queries.map(async([kind,query])=>{
    const url=new URL(endpoint);
    if(url.protocol!=="https:")throw Error("검색 공급처는 HTTPS 주소여야 합니다.");
    url.searchParams.set("channel",channel);url.searchParams.set("q",query);
    url.searchParams.set("kind",kind);url.searchParams.set("sort",kind==="similar"?"reviews_desc":"relevance");
    const response=await request(url,{redirect:"error",signal:AbortSignal.timeout(15000),
      headers:process.env.ACC_RESEARCH_TOKEN?{Authorization:"Bearer "+process.env.ACC_RESEARCH_TOKEN}:{}});
    if(!response.ok)throw Error("검색 공급처 응답을 확인하세요.");
    const data=await response.json();
    if(data.channel!==channel || !Array.isArray(data.items))throw Error("검색 공급처 응답 형식이 다릅니다.");
    return data.items.slice(0,100).filter(s=>s && ["title","seller","url","option","time"].every(k=>typeof s[k]==="string" && s[k].trim()) &&
      /^https?:\/\//i.test(s.url) && typeof s.match==="boolean" && Number.isFinite(Date.parse(s.time+"+09:00")) &&
      [s.price,s.shipping].every(n=>/^\d{1,9}$/.test(String(n))));
  }));
  return pages.flat();
}
module.exports={research};
