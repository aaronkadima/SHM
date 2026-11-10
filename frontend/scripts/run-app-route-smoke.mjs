#!/usr/bin/env node
import{spawn}from"node:child_process";
import{rm}from"node:fs/promises";

const chrome=process.env.CHROME_BIN||process.argv[2];
const targetUrl=process.env.APP_SMOKE_URL||process.argv[3]||"http://127.0.0.1:4181/#/live";
const timeoutMs=Number(process.env.APP_SMOKE_TIMEOUT_MS||180000);
const port=Number(process.env.APP_SMOKE_DEBUG_PORT||9231);
const windowSize=process.env.APP_SMOKE_WINDOW_SIZE||"1280,800";
if(!chrome)throw new Error("Chrome/Chromium executable was not provided.");

const profile="/tmp/shm-app-route-smoke-"+process.pid;
const args=[
  "--headless=new","--no-sandbox","--disable-gpu","--disable-dev-shm-usage",
  "--remote-debugging-address=127.0.0.1","--remote-debugging-port="+port,
  "--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream",
  "--user-data-dir="+profile,"--window-size="+windowSize,targetUrl
];
const child=spawn(chrome,args,{stdio:["ignore","ignore","pipe"]});
let chromeErr="";
child.stderr.on("data",chunk=>{chromeErr=(chromeErr+chunk.toString()).slice(-12000)});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function json(url){
  const response=await fetch(url,{cache:"no-store"});
  if(!response.ok)throw new Error("HTTP "+response.status+" "+url);
  return response.json();
}
async function waitTarget(){
  const deadline=Date.now()+30000;
  let lastError=null;
  while(Date.now()<deadline){
    if(child.exitCode!=null)throw new Error("Chrome exited before DevTools became ready.\n"+chromeErr);
    try{
      const list=await json("http://127.0.0.1:"+port+"/json/list");
      const wanted=new URL(targetUrl);
      const target=list.find(x=>x.type==="page"&&x.webSocketDebuggerUrl&&(()=>{try{const u=new URL(x.url);return u.origin===wanted.origin&&u.pathname===wanted.pathname}catch{return false}})());
      if(target)return target;
    }catch(error){lastError=error}
    await sleep(250);
  }
  throw new Error("Timed out waiting for Chrome DevTools target. "+(lastError?.message||""));
}
function connect(wsUrl){
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket(wsUrl);
    ws.addEventListener("open",()=>resolve(ws),{once:true});
    ws.addEventListener("error",()=>reject(new Error("Could not connect to Chrome DevTools WebSocket.")),{once:true});
  });
}
function cdp(ws){
  let id=0;const pending=new Map();
  ws.addEventListener("message",event=>{
    let msg;try{msg=JSON.parse(String(event.data))}catch{return}
    if(!msg.id)return;
    const item=pending.get(msg.id);if(!item)return;
    pending.delete(msg.id);
    if(msg.error)item.reject(new Error(msg.error.message||"CDP error"));
    else item.resolve(msg.result);
  });
  return(method,params={})=>new Promise((resolve,reject)=>{
    const requestId=++id;pending.set(requestId,{resolve,reject});
    ws.send(JSON.stringify({id:requestId,method,params}));
  });
}

// Smoke de rotas do app: cada rota monta sem cair na tela "Falha ao carregar o SHM".
// Visita #/live (câmera falsa), #/aulas e volta para #/analysis na mesma página.
const ROUTES=[["live",".liveCam"],["aulas",".editorAulasFrame"],["analysis",".analysisEditor"]];
async function main(){
  const target=await waitTarget(),ws=await connect(target.webSocketDebuggerUrl),request=cdp(ws);
  await request("Runtime.enable");
  const evaluate=async expression=>{const r=await request("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(r?.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r?.result?.value};
  const report=[];
  const diag=()=>evaluate('JSON.stringify({href:location.href,ready:document.readyState,root:(document.getElementById("root")?.innerHTML||"").slice(0,300),text:(document.body?.innerText||"").slice(0,300)})').catch(e=>String(e));
  // Espera o app montar (o index.html pode recarregar uma vez para furar cache após deploy).
  const bootDeadline=Date.now()+60000;let booted=false;
  while(Date.now()<bootDeadline){try{booted=await evaluate('!!document.querySelector(".appShell")||!!document.querySelector(".appRuntimeError")')}catch{}if(booted)break;await sleep(500)}
  if(!booted)throw new Error("App não montou em 60 s. "+await diag());
  for(const [route,selector] of ROUTES){
    await evaluate(`(()=>{location.hash="#/${route}";return true})()`);
    const deadline=Date.now()+Math.min(timeoutMs,45000);let state=null;
    while(Date.now()<deadline){
      try{state=await evaluate(`(()=>({ok:!!document.querySelector(${JSON.stringify(selector)}),crash:document.querySelector(".appRuntimeError")?.innerText||""}))()`)}catch{state=null;await sleep(500);continue}
      if(state.crash)throw new Error("Rota #/"+route+" derrubou o app: "+state.crash);
      if(state.ok)break;
      await sleep(250);
    }
    if(!state?.ok)throw new Error("Rota #/"+route+" não montou "+selector+". "+await diag());
    report.push(route);
  }
  if(!(await evaluate('!!document.querySelector(".liveCam")'))){/* saiu do Live corretamente */}
  console.log("APP_ROUTE_SMOKE_PASS",JSON.stringify({routes:report}));
  ws.close();
}
main().then(async()=>{child.kill("SIGTERM");await rm(profile,{recursive:true,force:true}).catch(()=>{});process.exit(0)}).catch(async error=>{console.error(String(error?.stack||error));child.kill("SIGTERM");await rm(profile,{recursive:true,force:true}).catch(()=>{});process.exit(1)});
