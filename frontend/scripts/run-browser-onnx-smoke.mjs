#!/usr/bin/env node
import{spawn}from"node:child_process";
import{rm}from"node:fs/promises";

const chrome=process.env.CHROME_BIN||process.argv[2];
const targetUrl=process.env.SMOKE_URL||process.argv[3]||"http://127.0.0.1:4177/e2e/browser-onnx-smoke.html";
const timeoutMs=Number(process.env.SMOKE_TIMEOUT_MS||180000);
const port=Number(process.env.SMOKE_DEBUG_PORT||9227);
const passToken=process.env.SMOKE_PASS_TOKEN||"BROWSER_ONNX_SMOKE_PASS";
const failToken=process.env.SMOKE_FAIL_TOKEN||"BROWSER_ONNX_SMOKE_FAIL";
if(!chrome)throw new Error("Chrome/Chromium executable was not provided.");

const profile="/tmp/shm-cdp-smoke-"+process.pid;
const args=[
  "--headless=new","--no-sandbox","--disable-gpu","--disable-dev-shm-usage",
  "--remote-debugging-address=127.0.0.1","--remote-debugging-port="+port,
  "--user-data-dir="+profile,"--window-size=1024,768",targetUrl
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
      const target=list.find(x=>x.type==="page"&&x.webSocketDebuggerUrl&&(x.url===targetUrl||x.url.includes("browser-onnx-smoke.html")));
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
  let id=0;
  const pending=new Map();
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

let ws;
try{
  const target=await waitTarget();
  ws=await connect(target.webSocketDebuggerUrl);
  const request=cdp(ws);
  await request("Runtime.enable");
  const deadline=Date.now()+timeoutMs;
  let lastText="";
  while(Date.now()<deadline){
    if(child.exitCode!=null)throw new Error("Chrome exited during smoke test.\n"+chromeErr);
    const result=await request("Runtime.evaluate",{
      expression:'document.getElementById("status")?.textContent || ""',
      returnByValue:true,
      awaitPromise:true
    });
    const value=String(result?.result?.value||"").trim();
    if(value&&value!==lastText){console.log(value);lastText=value}
    if(value.includes(passToken))process.exitCode=0;
    else if(value.includes(failToken))throw new Error(value);
    else{await sleep(500);continue}
    break;
  }
  if(process.exitCode!==0)throw new Error("Timed out waiting for "+passToken+". Last status: "+lastText);
}finally{
  try{ws?.close()}catch{}
  if(child.exitCode==null)child.kill("SIGTERM");
  await sleep(250);
  if(child.exitCode==null)child.kill("SIGKILL");
  await rm(profile,{recursive:true,force:true}).catch(()=>{});
}
