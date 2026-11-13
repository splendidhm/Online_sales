const {createApp}=require("./server");
const {mkdirSync}=require("node:fs");
const {randomBytes}=require("node:crypto");
const {join}=require("node:path");
const {spawn}=require("node:child_process");

const folder=join(__dirname,"data");
mkdirSync(folder,{recursive:true});
const token=randomBytes(32).toString("hex");
const port=Number(process.env.PORT??4173);
const server=createApp(join(folder,"candidates.sqlite"),token);
server.on("error",error=>{
  console.error(error.code==="EADDRINUSE"?"관리자 서버가 이미 실행 중입니다. 기존 관리자 창을 사용하세요.":"관리자 서버를 시작하지 못했습니다.");
  process.exitCode=1;
});
server.listen(port,"127.0.0.1",()=>{
  const address="http://127.0.0.1:"+server.address().port+"/#"+token;
  const opener=spawn("rundll32.exe",["url.dll,FileProtocolHandler",address],{windowsHide:true,stdio:"ignore"});
  opener.on("error",()=>console.log("브라우저를 열 수 없습니다. 이 컴퓨터에서 다음 주소를 여세요.\n"+address));
  console.log("관리자 웹이 실행 중입니다. 종료하려면 이 창에서 Ctrl+C를 누르세요.");
});
