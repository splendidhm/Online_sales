const {test}=require("node:test");
const assert=require("node:assert/strict");
const bcrypt=require("bcryptjs");
const {naverAuth,naverConfigured}=require("./naver-auth");
const {naverProvider}=require("./naver-provider");
const settings={ACC_NAVER_CLIENT_ID:"test-client",ACC_NAVER_CLIENT_SECRET:"$2a$04$abcdefghijklmnopqrstuu"};

test("네이버 서명·동시 발급 통합·유효기간 갱신·기존 토큰 호환",async()=>{
  let time=1700000000000,calls=0;
  const auth=naverAuth(async(url,init)=>{
    calls++;
    assert.ok(url.endsWith("/oauth2/token"));
    const form=new URLSearchParams(init.body);
    assert.equal(form.get("type"),"SELF");
    assert.equal(form.has("account_id"),false);
    assert.ok(await bcrypt.compare("test-client_"+time,Buffer.from(form.get("client_secret_sign"),"base64").toString()));
    return Response.json({access_token:"token-"+calls,expires_in:10800});
  },settings,()=>time);
  assert.deepEqual(await Promise.all([auth.token(),auth.token(),auth.token()]),["token-1","token-1","token-1"]);
  time+=1000;
  assert.equal(await auth.token(),"token-1");
  time+=10800000;
  assert.equal(await auth.token(),"token-2");
  auth.invalidate("token-1");
  assert.equal(await auth.token(),"token-2");
  assert.equal(calls,2);
  assert.equal(await naverAuth(()=>{throw Error("호출 금지");},{ACC_NAVER_ACCESS_TOKEN:"legacy"}).token(),"legacy");
  assert.equal(naverConfigured(settings),true);
  assert.equal(naverConfigured({ACC_NAVER_CLIENT_ID:"only"}),false);
});

test("토큰 발급 실패 시 응답의 비밀값을 숨기고 다음 호출에서 복구",async()=>{
  let calls=0;
  const auth=naverAuth(async()=>++calls===1?Response.json({message:"secret-value"},{status:403}):Response.json({access_token:"ok",expires_in:10800}),settings);
  await assert.rejects(auth.token(),e=>e.message.includes("403")&&!e.message.includes("secret-value"));
  assert.equal(await auth.token(),"ok");
  const invalid=naverAuth(async()=>Response.json({access_token:"x",expires_in:"bad"}),settings);
  await assert.rejects(invalid.token(),/유효시간/);
});

test("조회 401은 한 번 갱신 후 재시도하며 상품 쓰기는 재전송하지 않는다",async()=>{
  let issued=0,reads=0,writes=0;
  const provider=naverProvider(async(url,init)=>{
    if(url.endsWith("/oauth2/token"))return Response.json({access_token:"t"+(++issued),expires_in:10800});
    if(init.method==="GET")return ++reads===1?new Response("",{status:401}):Response.json([{name:"연습",url:"https://example.com",channelType:"STOREFARM",privateField:"제외"}]);
    writes++;return new Response("",{status:401});
  },settings);
  assert.deepEqual(await provider.channels(),[{name:"연습",url:"https://example.com",channelType:"STOREFARM"}]);
  assert.equal(issued,2);
  await assert.rejects(provider.upload({draft:{image:"data:image/jpeg;base64,YWJj"}}),e=>e.rejected===true);
  assert.equal(writes,1);
  await provider.channels();
  assert.equal(issued,3);
  let attempts=0;
  const denied=naverProvider(async url=>url.endsWith("/oauth2/token")?Response.json({access_token:"t",expires_in:10800}):(attempts++,new Response("",{status:401})),settings);
  await assert.rejects(denied.channels(),/401/);
  assert.equal(attempts,2);
});
