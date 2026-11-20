"use strict";
const bcrypt=require("bcryptjs");

function naverConfigured(env=process.env){
  return Boolean(env.ACC_NAVER_ACCESS_TOKEN||(env.ACC_NAVER_CLIENT_ID&&env.ACC_NAVER_CLIENT_SECRET));
}

function naverAuth(request=fetch,env=process.env,now=Date.now){
  const clientId=env.ACC_NAVER_CLIENT_ID;
  const secret=env.ACC_NAVER_CLIENT_SECRET;
  const automatic=Boolean(clientId&&secret);
  let cached=null,inFlight=null;
  async function issue(){
    const timestamp=String(now());
    let signature;
    try{signature=Buffer.from(await bcrypt.hash(clientId+"_"+timestamp,secret)).toString("base64");}
    catch{throw Error("네이버 애플리케이션 시크릿 형식을 확인하세요.");}
    const body=new URLSearchParams({client_id:clientId,timestamp,client_secret_sign:signature,grant_type:"client_credentials",type:"SELF"});
    let response;
    try{
      response=await request("https://api.commerce.naver.com/external/v1/oauth2/token",{
        method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:body.toString(),
        redirect:"error",signal:AbortSignal.timeout(30000)
      });
    }catch{throw Error("네이버 인증 서버 연결 실패 · 네트워크를 확인한 뒤 다시 시도하세요.");}
    if(!response.ok)throw Error("네이버 토큰 발급 실패 ("+response.status+") · ID·시크릿·호출 IP·PC 시각을 확인하세요.");
    let data;
    try{data=await response.json();}catch{throw Error("네이버 인증 응답 형식을 확인할 수 없습니다.");}
    if(typeof data.access_token!=="string"||!data.access_token||!Number.isFinite(data.expires_in)||data.expires_in<=0)
      throw Error("네이버 인증 응답에 토큰 또는 유효시간이 없습니다.");
    cached={token:data.access_token,refreshAt:now()+Math.max(0,data.expires_in-60)*1000};
    return cached.token;
  }
  return {
    async token(){
      if(!automatic){
        if(env.ACC_NAVER_ACCESS_TOKEN)return env.ACC_NAVER_ACCESS_TOKEN;
        throw Error("네이버 애플리케이션 ID·시크릿 또는 접근 토큰을 설정하세요.");
      }
      if(cached&&now()<cached.refreshAt)return cached.token;
      if(!inFlight)inFlight=issue().finally(()=>{inFlight=null;});
      return inFlight;
    },
    invalidate(token){if(cached?.token===token)cached=null;},
    automatic
  };
}
module.exports={naverAuth,naverConfigured};
