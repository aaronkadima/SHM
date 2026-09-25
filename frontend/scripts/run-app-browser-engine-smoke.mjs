#!/usr/bin/env node
import{spawn}from"node:child_process";
import{rm}from"node:fs/promises";

const chrome=process.env.CHROME_BIN||process.argv[2];
const targetUrl=process.env.APP_SMOKE_URL||process.argv[3]||"http://127.0.0.1:4181/#/analysis";
const timeoutMs=Number(process.env.APP_SMOKE_TIMEOUT_MS||180000);
const port=Number(process.env.APP_SMOKE_DEBUG_PORT||9231);
const engineId=process.env.APP_SMOKE_ENGINE||"yolov8n_public_crack_seg";
const fixtureUrl=process.env.APP_SMOKE_FIXTURE||"/browser-models/yolov8n_public_crack_seg.parity.png";
if(!chrome)throw new Error("Chrome/Chromium executable was not provided.");

const profile="/tmp/shm-app-browser-smoke-"+process.pid;
const args=[
  "--headless=new","--no-sandbox","--disable-gpu","--disable-dev-shm-usage",
  "--remote-debugging-address=127.0.0.1","--remote-debugging-port="+port,
  "--user-data-dir="+profile,"--window-size=1280,800",targetUrl
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

async function evaluate(request,expression){
  const result=await request("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
  if(result?.exceptionDetails){
    const details=result.exceptionDetails;
    const description=details.exception?.description||details.exception?.value||details.text||"Runtime evaluation failed";
    throw new Error(String(description));
  }
  return result?.result?.value;
}
async function waitUntil(request,testExpression,label,timeout=30000){
  const deadline=Date.now()+timeout;
  let last=null;
  while(Date.now()<deadline){
    if(child.exitCode!=null)throw new Error("Chrome exited while waiting for "+label+".\n"+chromeErr);
    last=await evaluate(request,testExpression);
    if(last)return last;
    await sleep(300);
  }
  throw new Error("Timed out waiting for "+label+". Last value: "+JSON.stringify(last));
}

let ws;
try{
  const target=await waitTarget();
  ws=await connect(target.webSocketDebuggerUrl);
  const request=cdp(ws);
  await request("Runtime.enable");
  await request("Page.enable");
  const wantedOrigin=new URL(targetUrl).origin;
  await waitUntil(request,`document.readyState==="complete"&&location.origin===${JSON.stringify(wantedOrigin)}`,"initial SHM document",30000);

  await evaluate(request,`(()=>{
    localStorage.setItem("shmSelectedEngines",JSON.stringify([${JSON.stringify(engineId)}]));
    localStorage.removeItem("shm.viewer.preferences.v1");
    localStorage.removeItem("shmInspectionMetaDraft");
    return true;
  })()`);
  await request("Page.reload",{ignoreCache:true});
  await waitUntil(request,'document.readyState==="complete"&&!!document.querySelector(".analysisEditor")',"analysis workspace");

  const injected=await evaluate(request,`(async()=>{
    const response=await fetch(${JSON.stringify(fixtureUrl)},{cache:"no-store"});
    if(!response.ok)throw new Error("fixture HTTP "+response.status);
    const blob=await response.blob();
    const file=new File([blob],"full-app-browser-smoke.png",{type:blob.type||"image/png"});
    const input=document.querySelector('.editorTopActions input[type="file"]');
    if(!input)throw new Error("analysis file input not found");
    const dt=new DataTransfer();dt.items.add(file);input.files=dt.files;
    input.dispatchEvent(new Event("change",{bubbles:true}));
    return {bytes:blob.size,type:file.type};
  })()`);
  console.log("APP_BROWSER_SMOKE_FIXTURE",JSON.stringify(injected));

  await waitUntil(request,'(()=>{const b=document.querySelector(".editorPrimary");return !!b&&!b.disabled&&document.querySelector(".editorEngineState")?.textContent.includes("browser local")})()',"browser engine ready",30000);
  const before=await evaluate(request,'({engine:document.querySelector(".editorEngineState")?.textContent||"",status:document.querySelector(".editorStatusMessage")?.textContent||""})');
  console.log("APP_BROWSER_SMOKE_READY",JSON.stringify(before));

  await evaluate(request,'(()=>{document.querySelector(".editorPrimary")?.click();return true})()');

  const deadline=Date.now()+timeoutMs;
  let state=null;
  while(Date.now()<deadline){
    state=await evaluate(request,`(()=>{
      const error=document.querySelector(".editorStatusMessage")?.textContent?.trim()||"";
      const rows=[...document.querySelectorAll(".editorResultRow")];
      const overlay=document.querySelector(".engineOverlayImage");
      const panel=document.querySelector(".editorFloating");
      const progress=document.querySelector(".editorProgress");
      return{
        error,
        resultRows:rows.length,
        resultText:rows.map(x=>x.textContent?.trim()||""),
        overlay:!!overlay,
        overlaySrc:overlay?.getAttribute("src")||"",
        panel:!!panel,
        progress:!!progress,
        comparison:[...document.querySelectorAll(".editorPaneBadge")].map(x=>x.textContent?.trim()||""),
        engine:document.querySelector(".editorEngineState")?.textContent?.trim()||""
      };
    })()`);
    if(state.resultRows>0&&state.overlay&&state.panel&&!state.progress)break;
    if(/Checksum|Manifesto browser indisponível|Artefato ONNX indisponível|ONNX Runtime|Falha|Error/i.test(state.error)&&!state.progress){
      throw new Error("Application reported browser-engine failure: "+JSON.stringify(state));
    }
    await sleep(500);
  }
  if(!(state?.resultRows>0&&state?.overlay&&state?.panel&&!state?.progress)){
    throw new Error("Full application did not reveal browser result/overlay: "+JSON.stringify(state));
  }
  if(!String(state.overlaySrc||"").startsWith("data:image/png;base64,"))throw new Error("Overlay is not an inline PNG result.");
  if(!state.comparison.some(x=>/camadas|detec/i.test(x)))throw new Error("Viewer did not switch to an overlay-capable comparison.");
  console.log("APP_BROWSER_ENGINE_SMOKE_PASS",JSON.stringify(state));
}finally{
  try{ws?.close()}catch{}
  if(child.exitCode==null)child.kill("SIGTERM");
  await sleep(250);
  if(child.exitCode==null)child.kill("SIGKILL");
  await rm(profile,{recursive:true,force:true}).catch(()=>{});
}
