async function verifiedImage(page,request,allowedOrigin){
  const settings=JSON.parse(page.draft.marketProfile);
  const image=new URL(settings.imageUrl);
  if(image.protocol!=="https:"||image.username||image.password||image.port||image.origin!==allowedOrigin)throw Error("서버에 지정한 상품 이미지 출처를 사용하세요.");
  const bytes=Buffer.from(page.draft.image.split(",")[1],"base64");
  const response=await request(image,{redirect:"error",signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error("상품 이미지 조회 실패");
  let offset=0;
  for await(const chunk of response.body){
    if(!bytes.subarray(offset,offset+chunk.length).equals(Buffer.from(chunk)))throw Error("승인 사진과 공개 이미지가 다릅니다.");
    offset+=chunk.length;
  }
  if(offset!==bytes.length)throw Error("공개 이미지 크기가 다릅니다.");
  return image.href;
}
module.exports={verifiedImage};
