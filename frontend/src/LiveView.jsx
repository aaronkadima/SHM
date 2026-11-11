import React,{useCallback,useEffect,useMemo,useRef,useState}from"react";
import{Camera,CameraOff,Download,FileJson,FileVideo,Flashlight,ImageDown,Images,MapPin,Play,RefreshCw,ScanSearch,Settings2,SwitchCamera,Trash2,Video,X}from"lucide-react";
import{LIVE_ENGINES,LIVE_ENGINE_IDS}from"./liveEngines.js";

const RESOLUTIONS={"720p":[1280,720],"1080p":[1920,1080],"4K":[3840,2160]};
const DISPLAY_MAX_SIDE=1280;
const VIDEO_MIME_CANDIDATES=["video/mp4;codecs=avc1.42E01E","video/mp4","video/webm;codecs=vp9","video/webm;codecs=vp8","video/webm"];

function pickVideoMime(){
  if(typeof MediaRecorder==="undefined")return null;
  for(const type of VIDEO_MIME_CANDIDATES){try{if(MediaRecorder.isTypeSupported(type))return type}catch{}}
  return "";
}
function stamp(date=new Date()){
  const p=n=>String(n).padStart(2,"0");
  return date.getFullYear()+p(date.getMonth()+1)+p(date.getDate())+"-"+p(date.getHours())+p(date.getMinutes())+p(date.getSeconds());
}
function canvasBlob(canvas,type="image/png",quality){return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("Falha ao gerar imagem.")),type,quality))}
function download(url,name){const a=document.createElement("a");a.href=url;a.download=name;a.click()}
function fmtDuration(ms){const s=Math.floor(ms/1000);return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0")}
// Salvar na galeria do aparelho: o navegador não grava direto no app Fotos; o compartilhamento
// nativo (Web Share com arquivos) oferece "Salvar imagem/vídeo" no iOS e Android. Sem suporte
// (desktop), cai para download.
function captureFiles(items){
  return items.flatMap(c=>c.kind==="photo"
    ?[new File([c.annotated.blob],c.annotated.name,{type:c.annotated.blob.type||"image/png",lastModified:c.createdAt})]
    :[new File([c.video.blob],c.video.name,{type:c.video.blob.type||"video/mp4",lastModified:c.createdAt})]);
}
export function canShareToDevice(files){try{return !!navigator.canShare?.({files})}catch{return false}}
async function saveFilesToDevice(files){
  if(files.length&&canShareToDevice(files)){
    try{await navigator.share({files,title:"SHM Vision Lab · capturas"});return"shared"}
    catch(e){if(e?.name==="AbortError")return"cancelled";if(e?.name!=="NotAllowedError")throw e}
  }
  for(const f of files){const u=URL.createObjectURL(f);download(u,f.name);setTimeout(()=>URL.revokeObjectURL(u),4000)}
  return"downloaded";
}
function safeSlug(v){return String(v||"").trim().replace(/[^\w.-]+/g,"_").slice(0,40)}

export default function LiveView({engines=[],selected=[],cdmOptions={},inspectionMeta={},appInfo={},onAnalyzeFrame,onClose}){
  const liveEngines=useMemo(()=>LIVE_ENGINE_IDS.filter(id=>engines.some(e=>e.id===id&&e.browser_ready)).map(id=>({id,...LIVE_ENGINES[id],catalog:engines.find(e=>e.id===id)})),[engines]);
  const initialEngine=useMemo(()=>{
    const pref=localStorage.getItem("shmLiveEngine");
    if(pref&&liveEngines.some(e=>e.id===pref))return pref;
    const sel=selected.find(id=>liveEngines.some(e=>e.id===id));
    return sel||liveEngines[0]?.id||"cdm_1";
  },[]);// eslint-disable-line react-hooks/exhaustive-deps

  const[engineId,setEngineId]=useState(initialEngine);
  const[engineState,setEngineState]=useState({status:"idle",progress:0,error:""});
  const[source,setSource]=useState(null);// {kind:"camera"|"file",label}
  const[streamState,setStreamState]=useState({status:"idle",error:""});
  const[devices,setDevices]=useState([]);
  const[deviceId,setDeviceId]=useState("");
  const[facing,setFacing]=useState("environment");
  const[resolution,setResolution]=useState(()=>localStorage.getItem("shmLiveResolution")||"1080p");
  const[detecting,setDetecting]=useState(true);
  const[opacity,setOpacity]=useState(.62);
  const[showBoxes,setShowBoxes]=useState(true);
  const[smoothing,setSmoothing]=useState(true);
  const[fpsCap,setFpsCap]=useState(8);
  const[confidence,setConfidence]=useState(.25);
  const[torch,setTorch]=useState({supported:false,on:false});
  const[geoOn,setGeoOn]=useState(false);
  const[geo,setGeo]=useState(null);
  const[stats,setStats]=useState({fps:0,ifps:0,latency:null,counts:{},resolution:null});
  const[recording,setRecording]=useState(false);
  const[recElapsed,setRecElapsed]=useState(0);
  const[captures,setCaptures]=useState([]);
  const[notice,setNotice]=useState("");
  const[panel,setPanel]=useState(null);// "settings" | "gallery" | null
  const[mode,setMode]=useState(()=>localStorage.getItem("shmLiveMode")==="video"?"video":"photo");
  const[autoSave,setAutoSave]=useState(()=>localStorage.getItem("shmLiveAutoSave")==="1");
  const shareSupported=useMemo(()=>{try{return canShareToDevice([new File([new Blob(["x"],{type:"image/png"})],"t.png",{type:"image/png"})])}catch{return false}},[]);

  const videoRef=useRef(null),canvasRef=useRef(null),recCanvasRef=useRef(null),workCanvasRef=useRef(null),fileInputRef=useRef(null);
  const workerRef=useRef(null),streamRef=useRef(null),rafRef=useRef(0),fileUrlRef=useRef(null),wakeLockRef=useRef(null);
  const specRef=useRef(null),readyEngineRef=useRef(null),inflightRef=useRef(false),seqRef=useRef(0),lastSendRef=useRef(0);
  const resultRef=useRef(null),layerCanvasesRef=useRef([]),emaRef=useRef(new Map());
  const recorderRef=useRef(null),chunksRef=useRef([]),timelineRef=useRef([]),recStartRef=useRef(0);
  const capturesRef=useRef([]),geoRef=useRef(null),frameCountRef=useRef({display:0,t:performance.now()}),ifpsRef=useRef(0);
  const settingsRef=useRef({});
  settingsRef.current={engineId,detecting,opacity,showBoxes,smoothing,fpsCap,confidence,cdmOptions,inspectionMeta,geoOn};
  useEffect(()=>{capturesRef.current=captures},[captures]);
  useEffect(()=>{geoRef.current=geo},[geo]);
  useEffect(()=>{localStorage.setItem("shmLiveEngine",engineId)},[engineId]);
  useEffect(()=>{localStorage.setItem("shmLiveResolution",resolution)},[resolution]);
  useEffect(()=>{localStorage.setItem("shmLiveMode",mode)},[mode]);
  useEffect(()=>{localStorage.setItem("shmLiveAutoSave",autoSave?"1":"0")},[autoSave]);
  const panelRef=useRef(null);panelRef.current=panel;

  const flash=useCallback((text,ms=1800)=>{setNotice(text);clearTimeout(flash.t);flash.t=setTimeout(()=>setNotice(""),ms)},[]);
  const autoSaveRef=useRef(autoSave);autoSaveRef.current=autoSave;
  const saveCaptures=useCallback(async items=>{
    if(!items.length)return;
    try{
      const r=await saveFilesToDevice(captureFiles(items));
      if(r==="shared"){flash(items.length>1?items.length+" capturas enviadas para salvar":"Escolha “Salvar imagem/vídeo” para guardar na galeria",2600);setCaptures(list=>list.map(c=>items.some(i=>i.id===c.id)?{...c,saved:true}:c))}
      else if(r==="downloaded"){flash(items.length>1?items.length+" arquivos baixados":"Arquivo baixado no dispositivo",2200);setCaptures(list=>list.map(c=>items.some(i=>i.id===c.id)?{...c,saved:true}:c))}
    }catch(e){flash("Não foi possível salvar: "+String(e?.message||e),3200)}
  },[flash]);

  // ---------- Worker ----------
  const engineOpts=useCallback(()=>{
    const s=settingsRef.current;
    return s.engineId==="cdm_1"?{...s.cdmOptions}:{confidence:s.confidence};
  },[]);
  const workerControl=useMemo(()=>({channel:appInfo.channel,buildSha:appInfo.buildSha}),[appInfo.channel,appInfo.buildSha]);

  const updateLayers=useCallback(result=>{
    const s=settingsRef.current,ema=emaRef.current,canvases=[];
    for(const layer of result.layers||[]){
      const{w,h,mask,color,id}=layer,n=w*h;
      let show=mask;
      if(s.smoothing){
        let acc=ema.get(id);
        if(!acc||acc.length!==n){acc=new Float32Array(n);for(let i=0;i<n;i++)acc[i]=mask[i];ema.set(id,acc)}
        else for(let i=0;i<n;i++)acc[i]=acc[i]*.55+mask[i]*.45;
        show=new Uint8Array(n);for(let i=0;i<n;i++)show[i]=acc[i]>=.5?1:0;
      }
      const c=document.createElement("canvas");c.width=w;c.height=h;
      const ctx=c.getContext("2d"),img=ctx.createImageData(w,h);
      for(let i=0,j=0;i<n;i++,j+=4)if(show[i]){img.data[j]=color[0];img.data[j+1]=color[1];img.data[j+2]=color[2];img.data[j+3]=255}
      ctx.putImageData(img,0,0);canvases.push(c);
    }
    layerCanvasesRef.current=canvases;
  },[]);

  useEffect(()=>{
    const worker=new Worker(new URL("./liveWorker.js",import.meta.url),{type:"module"});
    workerRef.current=worker;
    worker.onmessage=e=>{
      const msg=e.data||{},current=settingsRef.current.engineId;
      if(msg.engineId&&msg.engineId!==current)return;
      if(msg.type==="progress"){setEngineState(s=>({...s,status:"loading",progress:Number(msg.progress?.completed||0)}));return}
      if(msg.type==="ready"){specRef.current=msg.spec;readyEngineRef.current=msg.engineId;setEngineState({status:"ready",progress:100,error:"",manifest:msg.manifest});return}
      if(msg.type==="error"){
        inflightRef.current=false;
        if(msg.stage==="init")setEngineState({status:"error",progress:0,error:msg.error});
        else setEngineState(s=>({...s,error:msg.error}));
        return;
      }
      if(msg.type==="result"){
        inflightRef.current=false;
        const result={...msg,receivedAt:performance.now()};
        const prevAt=resultRef.current?.receivedAt;
        if(prevAt){const inst=1000/Math.max(1,result.receivedAt-prevAt);ifpsRef.current=ifpsRef.current?ifpsRef.current*.7+inst*.3:inst}
        resultRef.current=result;updateLayers(result);
        if(recorderRef.current?.state==="recording")timelineRef.current.push({t_ms:Math.round(performance.now()-recStartRef.current),latency_ms:Math.round(msg.latency_ms),counts:msg.counts,boxes:(msg.boxes||[]).map(b=>({label:b.label,score:b.score,box:[b.x1,b.y1,b.x2,b.y2].map(v=>Number(v.toFixed(4)))}))});
      }
    };
    worker.onerror=e=>{inflightRef.current=false;setEngineState({status:"error",progress:0,error:e.message||"Falha no worker do modo Live."})};
    return()=>{worker.terminate();workerRef.current=null};
  },[updateLayers]);

  useEffect(()=>{
    if(!workerRef.current)return;
    specRef.current=null;readyEngineRef.current=null;inflightRef.current=false;resultRef.current=null;ifpsRef.current=0;layerCanvasesRef.current=[];emaRef.current=new Map();
    setEngineState({status:"loading",progress:0,error:""});
    workerRef.current.postMessage({type:"init",engineId,control:workerControl,opts:{}});
  },[engineId,workerControl]);

  // ---------- Fonte de vídeo ----------
  const stopSource=useCallback(()=>{
    streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null;
    const v=videoRef.current;if(v){v.pause();v.srcObject=null;v.removeAttribute("src");v.load?.()}
    if(fileUrlRef.current){URL.revokeObjectURL(fileUrlRef.current);fileUrlRef.current=null}
    wakeLockRef.current?.release?.().catch(()=>{});wakeLockRef.current=null;
    setTorch({supported:false,on:false});setSource(null);setStreamState({status:"idle",error:""});
  },[]);

  const requestWakeLock=useCallback(async()=>{try{wakeLockRef.current=await navigator.wakeLock?.request?.("screen")}catch{}},[]);

  // Presença de câmera: verifica dispositivos antes de abrir e reage a conectar/desconectar.
  const listCameras=useCallback(async()=>{
    try{return(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==="videoinput")}catch{return null}
  },[]);
  const allowStaticRef=useRef(false),staticRef=useRef({prev:null,since:0,last:0}),staticCanvasRef=useRef(null);
  const startCamera=useCallback(async(opts={})=>{
    if(!navigator.mediaDevices?.getUserMedia){setStreamState({status:"error",error:"Câmera indisponível neste navegador ou fora de conexão HTTPS."});return}
    if(recorderRef.current?.state==="recording"){flash("Pare a gravação antes de trocar a fonte.");return}
    allowStaticRef.current=!!opts.allowStatic;staticRef.current={prev:null,since:0,last:0};
    const cams=await listCameras();
    if(cams&&!cams.length){stopSource();setStreamState({status:"nocamera",error:"Nenhuma câmera foi encontrada neste dispositivo."});return}
    stopSource();setStreamState({status:"starting",error:""});
    const[w,h]=RESOLUTIONS[opts.resolution||resolution]||RESOLUTIONS["1080p"];
    const dev=opts.deviceId??deviceId,face=opts.facing||facing;
    const video={width:{ideal:w},height:{ideal:h},frameRate:{ideal:30}};
    if(dev)video.deviceId={exact:dev};else video.facingMode={ideal:face};
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video,audio:false});
      streamRef.current=stream;
      stream.getVideoTracks()[0]?.addEventListener("ended",()=>{
        if(streamRef.current!==stream)return;
        stopSource();setStreamState({status:"nocamera",error:"A câmera foi desconectada."});
      });
      const v=videoRef.current;v.srcObject=stream;v.muted=true;await v.play().catch(()=>{});
      const track=stream.getVideoTracks()[0],settings=track?.getSettings?.()||{},caps=track?.getCapabilities?.()||{};
      setTorch({supported:!!caps.torch,on:false});
      setSource({kind:"camera",label:track?.label||"Câmera"});
      setStreamState({status:"live",error:""});
      if(settings.deviceId&&!dev)setDeviceId("");
      const list=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==="videoinput");
      setDevices(list.map((d,i)=>({id:d.deviceId,label:d.label||"Câmera "+(i+1)})));
      requestWakeLock();
    }catch(error){
      const name=error?.name;
      const msg=name==="NotAllowedError"?"Permissão de câmera negada. Libere o acesso nas configurações do navegador.":name==="NotFoundError"||name==="DevicesNotFoundError"?"Nenhuma câmera foi encontrada neste dispositivo.":name==="NotReadableError"?"A câmera está em uso por outro aplicativo ou não responde.":name==="OverconstrainedError"?"A câmera não aceita essa resolução; tente uma menor.":String(error?.message||error);
      setStreamState({status:name==="NotFoundError"||name==="DevicesNotFoundError"?"nocamera":"error",error:msg});
    }
  },[deviceId,facing,resolution,stopSource,requestWakeLock,flash,listCameras]);

  // Ao conectar uma câmera com o aviso aberto, inicia sozinho; ao remover a câmera em uso, avisa.
  const streamStatusRef=useRef(streamState.status);streamStatusRef.current=streamState.status;
  useEffect(()=>{
    const md=navigator.mediaDevices;if(!md?.addEventListener)return;
    const onChange=async()=>{
      const cams=await listCameras();if(!cams)return;
      const st=streamStatusRef.current;
      if((st==="nocamera"||st==="error")&&cams.length)startCamera();
      else if(st==="live"&&streamRef.current&&!cams.length){stopSource();setStreamState({status:"nocamera",error:"A câmera foi desconectada."})}
      else setDevices(cams.map((d,i)=>({id:d.deviceId,label:d.label||"Câmera "+(i+1)})));
    };
    md.addEventListener("devicechange",onChange);return()=>md.removeEventListener("devicechange",onChange);
  },[listCameras,startCamera,stopSource]);

  const startFile=useCallback(async file=>{
    if(!file)return;
    if(recorderRef.current?.state==="recording"){flash("Pare a gravação antes de trocar a fonte.");return}
    stopSource();setStreamState({status:"starting",error:""});
    const url=URL.createObjectURL(file);fileUrlRef.current=url;
    const v=videoRef.current;v.srcObject=null;v.src=url;v.loop=true;v.muted=true;
    try{await v.play();setSource({kind:"file",label:file.name});setStreamState({status:"live",error:""});requestWakeLock()}
    catch(error){setStreamState({status:"error",error:"Não foi possível reproduzir o vídeo: "+String(error?.message||error)})}
  },[stopSource,requestWakeLock,flash]);

  const toggleTorch=useCallback(async()=>{
    const track=streamRef.current?.getVideoTracks()[0];if(!track)return;
    try{await track.applyConstraints({advanced:[{torch:!torch.on}]});setTorch(t=>({...t,on:!t.on}))}catch{flash("Lanterna indisponível nesta câmera.")}
  },[torch.on,flash]);

  useEffect(()=>{
    if(!geoOn||!navigator.geolocation){setGeo(null);return}
    const id=navigator.geolocation.watchPosition(p=>setGeo({lat:p.coords.latitude,lon:p.coords.longitude,accuracy_m:p.coords.accuracy,altitude_m:p.coords.altitude,at:new Date(p.timestamp).toISOString()}),err=>{flash("Localização indisponível: "+err.message,3000);setGeoOn(false)},{enableHighAccuracy:true,maximumAge:5000,timeout:15000});
    return()=>navigator.geolocation.clearWatch(id);
  },[geoOn,flash]);

  // ---------- Composição (vídeo + camadas + HUD) ----------
  const drawComposite=useCallback((ctx,W,H,{hud=true}={})=>{
    const v=videoRef.current,s=settingsRef.current,result=resultRef.current;
    ctx.drawImage(v,0,0,W,H);
    const fresh=result&&s.detecting&&readyEngineRef.current===s.engineId;
    if(fresh){
      ctx.save();ctx.globalAlpha=s.opacity;ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
      for(const c of layerCanvasesRef.current)ctx.drawImage(c,0,0,W,H);
      ctx.restore();
      if(s.showBoxes&&result.boxes?.length){
        const lw=Math.max(2,W/480),fs=Math.max(11,Math.round(W/90));
        ctx.save();ctx.lineWidth=lw;ctx.font="600 "+fs+"px system-ui,sans-serif";ctx.textBaseline="bottom";
        for(const b of result.boxes.slice(0,60)){
          const x=b.x1*W,y=b.y1*H,w=(b.x2-b.x1)*W,h=(b.y2-b.y1)*H,col="rgb("+b.color.join(",")+")";
          ctx.strokeStyle=col;ctx.strokeRect(x,y,w,h);
          if(b.score!=null){const t=b.label+" "+Math.round(b.score*100)+"%",tw=ctx.measureText(t).width+8;ctx.fillStyle=col;ctx.fillRect(x,Math.max(0,y-fs-6),tw,fs+6);ctx.fillStyle="#fff";ctx.fillText(t,x+4,Math.max(fs+3,y-3))}
        }
        ctx.restore();
      }
    }
    if(!hud)return;
    const fs=Math.max(12,Math.round(W/75)),pad=Math.round(fs*.7),lineH=Math.round(fs*1.35);
    const meta=s.inspectionMeta||{},g=geoRef.current,eng=LIVE_ENGINES[s.engineId]?.name||s.engineId;
    const counts=fresh?Object.entries(result.counts||{}).filter(([,n])=>n>0).map(([k,n])=>k+": "+n).join(" · "):"";
    const title="SHM Vision Lab · LIVE · "+eng;
    const where=[meta.oae_id,meta.element_id].filter(Boolean).join(" · ");
    const when=new Date().toLocaleString("pt-BR")+(g?" · "+g.lat.toFixed(6)+", "+g.lon.toFixed(6)+" ±"+Math.round(g.accuracy_m)+" m":"");
    const findings=fresh?(counts||"Sem achados no quadro"):(s.detecting?"Carregando motor…":"Detecção pausada");
    const barH=pad*2+lineH*3,top=H-barH+pad,maxW=W-pad*2;
    ctx.save();ctx.fillStyle="rgba(8,12,18,.62)";ctx.fillRect(0,H-barH,W,barH);
    ctx.font="600 "+fs+"px system-ui,sans-serif";ctx.textBaseline="top";ctx.fillStyle="#fff";
    const fit=t=>{if(ctx.measureText(t).width<=maxW)return t;while(t.length>1&&ctx.measureText(t+"…").width>maxW)t=t.slice(0,-1);return t+"…"};
    ctx.fillText(fit(title),pad,top);
    if(where){ctx.textAlign="right";const tw=ctx.measureText(title).width;if(tw+ctx.measureText(where).width+pad*2<maxW)ctx.fillText(where,W-pad,top);ctx.textAlign="left"}
    const whenLine=where&&ctx.measureText(title).width+ctx.measureText(where).width+pad*2>=maxW?where+" · "+when:when;
    ctx.fillText(fit(whenLine),pad,top+lineH);
    ctx.fillStyle=fresh&&counts?"#ffd27a":"#cfe3ec";ctx.fillText(fit(findings),pad,top+lineH*2);
    ctx.restore();
  },[]);

  // ---------- Envio de quadros ao worker ----------
  const sendFrame=useCallback(()=>{
    const v=videoRef.current,spec=specRef.current,worker=workerRef.current,s=settingsRef.current;
    if(!v||!spec||!worker||readyEngineRef.current!==s.engineId)return;
    const vw=v.videoWidth,vh=v.videoHeight;if(!vw||!vh)return;
    let c=workCanvasRef.current;if(!c){c=document.createElement("canvas");workCanvasRef.current=c}
    let w,h,letterbox=null;
    if(spec.mode==="maxSide"){const k=Math.min(1,spec.maxSide/Math.max(vw,vh));w=Math.max(1,Math.round(vw*k));h=Math.max(1,Math.round(vh*k))}
    else{w=spec.width;h=spec.height}
    if(c.width!==w)c.width=w;if(c.height!==h)c.height=h;
    const ctx=c.getContext("2d",{willReadFrequently:true});
    if(spec.mode==="letterbox"){
      const r=Math.min(w/vw,h/vh),dw=Math.max(1,Math.round(vw*r)),dh=Math.max(1,Math.round(vh*r)),px=(w-dw)/2,py=(h-dh)/2;
      ctx.fillStyle="rgb(114,114,114)";ctx.fillRect(0,0,w,h);ctx.drawImage(v,0,0,vw,vh,px,py,dw,dh);
      letterbox={padX:px,padY:py,drawW:dw,drawH:dh};
    }else ctx.drawImage(v,0,0,w,h);
    const buffer=ctx.getImageData(0,0,w,h).data.buffer;
    inflightRef.current=true;lastSendRef.current=performance.now();
    worker.postMessage({type:"frame",seq:++seqRef.current,engineId:s.engineId,width:w,height:h,buffer,letterbox,opts:{...engineOpts(),sourceMaxSide:Math.max(vw,vh)},control:workerControl},[buffer]);
  },[engineOpts,workerControl]);

  useEffect(()=>{
    let lastStats=performance.now();
    const tick=()=>{
      rafRef.current=requestAnimationFrame(tick);
      const v=videoRef.current,canvas=canvasRef.current;
      if(!v||!canvas||v.readyState<2||!v.videoWidth)return;
      const k=Math.min(1,DISPLAY_MAX_SIDE/Math.max(v.videoWidth,v.videoHeight));
      const W=Math.round(v.videoWidth*k),H=Math.round(v.videoHeight*k);
      if(canvas.width!==W)canvas.width=W;if(canvas.height!==H)canvas.height=H;
      drawComposite(canvas.getContext("2d"),W,H,{hud:false});
      const rc=recCanvasRef.current;
      if(rc&&recorderRef.current?.state==="recording")drawComposite(rc.getContext("2d"),rc.width,rc.height,{hud:true});
      frameCountRef.current.display++;
      const s=settingsRef.current,now=performance.now();
      // Câmera virtual/placeholder: quadros idênticos (sem ruído de sensor) por 3 s → não é câmera real.
      const st=staticRef.current;
      if(streamRef.current&&!allowStaticRef.current&&now-st.last>=250){
        st.last=now;
        let pc=staticCanvasRef.current;if(!pc){pc=document.createElement("canvas");pc.width=48;pc.height=27;staticCanvasRef.current=pc}
        const pctx=pc.getContext("2d",{willReadFrequently:true});pctx.drawImage(v,0,0,48,27);
        const d=pctx.getImageData(0,0,48,27).data;let diff=0;
        if(st.prev)for(let i=0;i<d.length;i+=4)diff+=Math.abs(d[i]-st.prev[i])+Math.abs(d[i+1]-st.prev[i+1]);
        st.prev=new Uint8ClampedArray(d);
        if(diff>0||!st.since)st.since=now;
        else if(now-st.since>3000){
          const label=streamRef.current.getVideoTracks()[0]?.label||"Câmera";
          stopSource();setStreamState({status:"static",error:"“"+label+"” está enviando uma imagem parada — parece uma câmera virtual ou sem sinal, não uma câmera real."});
          return;
        }
      }
      if(s.detecting&&!inflightRef.current&&now-lastSendRef.current>=1000/Math.max(1,s.fpsCap))sendFrame();
      if(now-lastStats>=400){
        const fc=frameCountRef.current,dt=(now-fc.t)/1000,r=resultRef.current;
        const stale=!r||now-r.receivedAt>3000||!s.detecting;
        setStats({fps:fc.display/dt,ifps:stale?0:ifpsRef.current,latency:r?.latency_ms??null,counts:r&&s.detecting?r.counts||{}:{},resolution:[v.videoWidth,v.videoHeight],metrics:r?.metrics||null});
        frameCountRef.current={display:0,t:now};lastStats=now;
        if(recorderRef.current?.state==="recording")setRecElapsed(now-recStartRef.current);
      }
    };
    rafRef.current=requestAnimationFrame(tick);
    return()=>cancelAnimationFrame(rafRef.current);
  },[drawComposite,sendFrame,stopSource]);

  // ---------- Captura de foto ----------
  const metadataFor=useCallback((kind,extra={})=>{
    const s=settingsRef.current,r=resultRef.current,v=videoRef.current;
    return{
      schema:"shm-live-capture/1",kind,captured_at:new Date().toISOString(),
      engine:{id:s.engineId,name:LIVE_ENGINES[s.engineId]?.name,manifest:engineState.manifest||null,options:engineOpts()},
      source:{kind:source?.kind||null,label:source?.label||null,video_resolution:v?[v.videoWidth,v.videoHeight]:null},
      inspection:s.inspectionMeta||{},geolocation:s.geoOn?geoRef.current:null,
      app:{channel:appInfo.channel,build:appInfo.buildSha,catalog:appInfo.catalogVersion},
      detections:r&&s.detecting?{counts:r.counts,latency_ms:r.latency_ms,metrics:r.metrics,boxes_normalized:(r.boxes||[]).map(b=>({label:b.label,score:b.score,box:[b.x1,b.y1,b.x2,b.y2]}))}:null,
      note:"Detecções do modo Live são preliminares (resolução reduzida, sem calibração mm/px). Use 'Analisar' para o processamento completo.",
      ...extra
    };
  },[engineState.manifest,engineOpts,source,appInfo]);

  const takePhoto=useCallback(async()=>{
    const v=videoRef.current;if(!v?.videoWidth){flash("Inicie uma fonte de vídeo primeiro.");return}
    const W=v.videoWidth,H=v.videoHeight,base="shm-live-"+safeSlug(settingsRef.current.inspectionMeta?.oae_id||"oae")+"-"+stamp();
    const raw=document.createElement("canvas");raw.width=W;raw.height=H;raw.getContext("2d").drawImage(v,0,0,W,H);
    const comp=document.createElement("canvas");comp.width=W;comp.height=H;drawComposite(comp.getContext("2d"),W,H);
    const[rawBlob,compBlob]=await Promise.all([canvasBlob(raw,"image/jpeg",.95),canvasBlob(comp,"image/png")]);
    const meta=metadataFor("photo",{files:{annotated:base+"-deteccoes.png",original:base+"-original.jpg"}});
    const jsonBlob=new Blob([JSON.stringify(meta,null,2)],{type:"application/json"});
    const item={id:crypto.randomUUID(),kind:"photo",base,createdAt:Date.now(),
      annotated:{blob:compBlob,url:URL.createObjectURL(compBlob),name:base+"-deteccoes.png"},
      original:{blob:rawBlob,url:URL.createObjectURL(rawBlob),name:base+"-original.jpg"},
      json:{blob:jsonBlob,url:URL.createObjectURL(jsonBlob),name:base+".json"},
      counts:meta.detections?.counts||{}};
    setCaptures(list=>[item,...list]);
    if(autoSaveRef.current)saveCaptures([item]);else flash("Foto salva nas capturas");
  },[drawComposite,metadataFor,flash,saveCaptures]);

  // ---------- Gravação de vídeo ----------
  const canRecord=typeof MediaRecorder!=="undefined"&&typeof HTMLCanvasElement!=="undefined"&&!!HTMLCanvasElement.prototype.captureStream;
  const startRecording=useCallback(()=>{
    const v=videoRef.current;
    if(!v?.videoWidth){flash("Inicie uma fonte de vídeo primeiro.");return}
    if(!canRecord){flash("Gravação de vídeo não suportada neste navegador.",3000);return}
    // Grava de um canvas próprio, com faixa de dados (OAE, data, achados); a tela fica limpa.
    const canvas=document.createElement("canvas"),k=Math.min(1,DISPLAY_MAX_SIDE/Math.max(v.videoWidth,v.videoHeight));
    canvas.width=Math.round(v.videoWidth*k);canvas.height=Math.round(v.videoHeight*k);
    drawComposite(canvas.getContext("2d"),canvas.width,canvas.height,{hud:true});recCanvasRef.current=canvas;
    const mimeType=pickVideoMime(),stream=canvas.captureStream(30);
    let rec;
    try{rec=new MediaRecorder(stream,{...(mimeType?{mimeType}:{}),videoBitsPerSecond:8_000_000})}
    catch(error){flash("Falha ao iniciar gravação: "+String(error?.message||error),3000);return}
    chunksRef.current=[];timelineRef.current=[];
    const startedAt=new Date(),startMeta=metadataFor("video");
    rec.ondataavailable=e=>{if(e.data?.size)chunksRef.current.push(e.data)};
    rec.onstop=()=>{
      stream.getTracks().forEach(t=>t.stop());
      const type=rec.mimeType||mimeType||"video/webm",ext=type.includes("mp4")?"mp4":"webm";
      const blob=new Blob(chunksRef.current,{type}),duration=performance.now()-recStartRef.current;
      const base="shm-live-"+safeSlug(settingsRef.current.inspectionMeta?.oae_id||"oae")+"-"+stamp(startedAt);
      const timeline={...startMeta,started_at:startedAt.toISOString(),duration_ms:Math.round(duration),mime_type:type,
        frames_analyzed:timelineRef.current.length,timeline:timelineRef.current,files:{video:base+"-deteccoes."+ext}};
      delete timeline.detections;
      const jsonBlob=new Blob([JSON.stringify(timeline,null,2)],{type:"application/json"});
      const totals={};for(const f of timelineRef.current)for(const[k,n]of Object.entries(f.counts||{}))totals[k]=Math.max(totals[k]||0,n);
      const videoItem={id:crypto.randomUUID(),kind:"video",base,createdAt:Date.now(),duration,
        video:{blob,url:URL.createObjectURL(blob),name:base+"-deteccoes."+ext},
        json:{blob:jsonBlob,url:URL.createObjectURL(jsonBlob),name:base+"-linha-do-tempo.json"},counts:totals};
      setCaptures(list=>[videoItem,...list]);
      setRecording(false);setRecElapsed(0);recCanvasRef.current=null;
      if(autoSaveRef.current)saveCaptures([videoItem]);else flash("Vídeo salvo nas capturas");
    };
    rec.start(1000);recorderRef.current=rec;recStartRef.current=performance.now();setRecording(true);
  },[canRecord,metadataFor,flash,drawComposite,saveCaptures]);
  const stopRecording=useCallback(()=>{if(recorderRef.current?.state==="recording")recorderRef.current.stop()},[]);

  // Abre a câmera direto, como o app de câmera do celular.
  const autoStartedRef=useRef(false);
  useEffect(()=>{if(autoStartedRef.current)return;autoStartedRef.current=true;startCamera()},[startCamera]);
  const shutter=useCallback(()=>{if(mode==="photo")takePhoto();else if(recorderRef.current?.state==="recording")stopRecording();else startRecording()},[mode,takePhoto,startRecording,stopRecording]);

  useEffect(()=>{
    const onKey=e=>{
      if(e.target?.closest?.("input,select,textarea"))return;
      if(e.key==="p"||e.key==="P"){e.preventDefault();takePhoto()}
      else if(e.key==="r"||e.key==="R"){e.preventDefault();recorderRef.current?.state==="recording"?stopRecording():startRecording()}
      else if(e.key===" "){e.preventDefault();setDetecting(d=>!d)}
      else if(e.key==="Escape"&&recorderRef.current?.state!=="recording"){e.preventDefault();if(panelRef.current)setPanel(null);else onClose?.()}
    };
    window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey);
  },[takePhoto,startRecording,stopRecording,onClose]);

  useEffect(()=>{
    const onVis=()=>{if(document.visibilityState==="visible"&&streamRef.current)requestWakeLock()};
    document.addEventListener("visibilitychange",onVis);return()=>document.removeEventListener("visibilitychange",onVis);
  },[requestWakeLock]);

  useEffect(()=>()=>{
    try{if(recorderRef.current?.state==="recording"){recorderRef.current.onstop=null;recorderRef.current.stop()}}catch{}
    streamRef.current?.getTracks().forEach(t=>t.stop());
    if(fileUrlRef.current)URL.revokeObjectURL(fileUrlRef.current);
    wakeLockRef.current?.release?.().catch(()=>{});
    for(const c of capturesRef.current)for(const k of["annotated","original","video","json"])if(c[k]?.url)URL.revokeObjectURL(c[k].url);
  },[]);

  function removeCapture(id){
    setCaptures(list=>{const item=list.find(c=>c.id===id);if(item)for(const k of["annotated","original","video","json"])if(item[k]?.url)URL.revokeObjectURL(item[k].url);return list.filter(c=>c.id!==id)});
  }
  function analyzeCapture(item){
    const file=new File([item.original.blob],item.original.name,{type:"image/jpeg",lastModified:item.createdAt});
    onAnalyzeFrame?.(file);
  }

  const live=streamState.status==="live",engineMeta=liveEngines.find(e=>e.id===engineId);
  const findings=Object.entries(stats.counts||{}).filter(([,n])=>n>0);
  const engineReady=engineState.status==="ready";
  const lastCapture=captures[0];
  const close=()=>{if(recording){flash("Pare a gravação antes de sair.");return}onClose?.()};
  return <section className="liveCam" aria-label="Modo Live · câmera com detecção em tempo real">
    <video ref={videoRef} playsInline muted autoPlay className="liveVideoSource"/>
    <canvas ref={canvasRef} className={"liveCamCanvas"+(live?"":" hidden")} aria-label="Vídeo com detecções em tempo real"/>
    <input ref={fileInputRef} hidden type="file" accept="video/*" onChange={e=>{const f=e.target.files?.[0];e.target.value="";startFile(f)}}/>

    {!live&&<div className="liveCamEmpty">
      <div className="liveCamCard">
        {streamState.status==="nocamera"?<>
          <span className="liveCamCardIcon warn"><CameraOff size={26}/></span><b>Conecte uma câmera</b><p>{streamState.error} Conecte uma webcam ou câmera USB — o Live inicia sozinho quando ela for detectada.</p>
          <div className="liveCamCardActions"><button className="primary" onClick={()=>startCamera()}><RefreshCw size={15}/> Verificar novamente</button><button onClick={()=>fileInputRef.current?.click()}><FileVideo size={15}/> Abrir vídeo</button></div>
        </>:streamState.status==="static"?<>
          <span className="liveCamCardIcon warn"><CameraOff size={26}/></span><b>Nenhuma câmera real detectada</b><p>{streamState.error} Conecte uma câmera para detectar em tempo real.</p>
          <div className="liveCamCardActions"><button className="primary" onClick={()=>startCamera()}><RefreshCw size={15}/> Verificar novamente</button><button onClick={()=>fileInputRef.current?.click()}><FileVideo size={15}/> Abrir vídeo</button><button onClick={()=>startCamera({allowStatic:true})}>Usar mesmo assim</button></div>
        </>:streamState.status==="error"?<>
          <Camera size={28}/><b>Câmera indisponível</b><p>{streamState.error}</p>
          <div className="liveCamCardActions"><button className="primary" onClick={()=>startCamera()}><RefreshCw size={15}/> Tentar novamente</button><button onClick={()=>fileInputRef.current?.click()}><FileVideo size={15}/> Abrir vídeo</button></div>
        </>:streamState.status==="idle"?<>
          <Camera size={28}/><b>Câmera encerrada</b>
          <div className="liveCamCardActions"><button className="primary" onClick={()=>startCamera()}><Camera size={15}/> Abrir câmera</button><button onClick={()=>fileInputRef.current?.click()}><FileVideo size={15}/> Abrir vídeo</button></div>
        </>:<><span className="liveSpinner" aria-hidden="true"/><b>Abrindo câmera…</b></>}
      </div>
    </div>}

    {/* Topo: sair · motor · ajustes */}
    <div className="liveFloat liveTop">
      <button className="liveRound" onClick={close} title="Voltar ao Studio (Esc)" aria-label="Fechar modo Live"><X size={20}/></button>
      <button className="liveChip" onClick={()=>setPanel(p=>p==="settings"?null:"settings")} title="Trocar motor e ajustes">
        <i className={"liveDot "+(!detecting?"paused":engineReady?"on":engineState.status==="error"?"err":"load")}/>
        <span>{engineMeta?.name||engineId}</span>
        <small>{!detecting?"pausado":engineReady?(stats.latency!=null?Math.round(stats.latency)+" ms":"pronto"):engineState.status==="error"?"erro":Math.round(engineState.progress)+"%"}</small>
      </button>
      <div className="liveTopRight">
        {torch.supported&&<button className={"liveRound"+(torch.on?" active":"")} onClick={toggleTorch} title="Lanterna" aria-label="Lanterna"><Flashlight size={18}/></button>}
        <button className={"liveRound"+(panel==="settings"?" active":"")} onClick={()=>setPanel(p=>p==="settings"?null:"settings")} title="Ajustes" aria-label="Ajustes do modo Live"><Settings2 size={18}/></button>
      </div>
    </div>

    {recording&&<div className="liveRec" role="status"><i/>{fmtDuration(recElapsed)}</div>}
    {notice&&<div className="liveToast" role="status">{notice}</div>}
    {engineState.error&&<div className="liveToast error" role="alert">{engineState.error}</div>}

    {/* Achados: só aparecem quando existem */}
    {live&&detecting&&findings.length>0&&<div className="liveFindings" aria-live="polite">
      {findings.map(([k,n])=><span key={k}><b>{n}</b> {k}</span>)}
    </div>}

    {/* Base: galeria · obturador · trocar câmera */}
    <div className="liveFloat liveBottom">
      <div className="liveModes" role="tablist" aria-label="Modo de captura">
        <button role="tab" aria-selected={mode==="photo"} className={mode==="photo"?"on":""} disabled={recording} onClick={()=>setMode("photo")}>FOTO</button>
        <button role="tab" aria-selected={mode==="video"} className={mode==="video"?"on":""} disabled={recording||!canRecord} title={canRecord?"":"Gravação não suportada neste navegador"} onClick={()=>setMode("video")}>VÍDEO</button>
      </div>
      <div className="liveBottomRow">
        <button className="liveThumb" onClick={()=>setPanel(p=>p==="gallery"?null:"gallery")} title="Capturas da sessão" aria-label={"Capturas da sessão: "+captures.length}>
          {lastCapture?(lastCapture.kind==="photo"?<img src={lastCapture.annotated.url} alt=""/>:<video src={lastCapture.video.url} muted playsInline/>):<Images size={20}/>}
          {captures.length>0&&<em>{captures.length}</em>}
        </button>
        <button className={"liveShutterBtn "+mode+(recording?" recording":"")} disabled={!live} onClick={shutter}
          title={mode==="photo"?"Capturar foto (P)":recording?"Parar gravação (R)":"Gravar vídeo (R)"} aria-label={mode==="photo"?"Capturar foto":recording?"Parar gravação":"Iniciar gravação"}><i/></button>
        <button className="liveRound big" disabled={!live||recording||source?.kind!=="camera"} onClick={()=>{const next=facing==="environment"?"user":"environment";setFacing(next);setDeviceId("");startCamera({facing:next,deviceId:""})}} title="Alternar câmera" aria-label="Alternar câmera"><SwitchCamera size={20}/></button>
      </div>
    </div>

    {panel&&<button className="liveScrim" aria-label="Fechar painel" onClick={()=>setPanel(null)}/>}

    {panel==="settings"&&<aside className="livePanel" aria-label="Ajustes do modo Live">
      <header><b>Ajustes</b><button onClick={()=>setPanel(null)} aria-label="Fechar ajustes"><X size={17}/></button></header>
      <div className="livePanelBody">
        <label className="liveLabel">Motor de detecção
          <select value={engineId} disabled={recording} onChange={e=>setEngineId(e.target.value)}>
            {liveEngines.map(e=><option key={e.id} value={e.id}>{e.catalog?.name||e.name}</option>)}
          </select>
          <small>{engineMeta?.note}</small>
          {engineState.status==="loading"&&<span className="liveProgress"><i style={{width:Math.max(4,engineState.progress)+"%"}}/></span>}
        </label>
        <div className="liveSwitchRow"><span>Detecção ativa</span><button className={"liveSwitch"+(detecting?" on":"")} role="switch" aria-checked={detecting} onClick={()=>setDetecting(d=>!d)}><i/></button></div>
        <label className="liveLabel">Taxa máxima de inferência <b>{fpsCap}/s</b><input type="range" min="1" max="20" value={fpsCap} onChange={e=>setFpsCap(Number(e.target.value))}/></label>
        {engineId==="yolov8n_public_crack_seg"&&<label className="liveLabel">Confiança mínima <b>{Math.round(confidence*100)}%</b><input type="range" min=".05" max=".9" step=".05" value={confidence} onChange={e=>setConfidence(Number(e.target.value))}/></label>}
        <label className="liveLabel">Opacidade das camadas <b>{Math.round(opacity*100)}%</b><input type="range" min=".1" max="1" step=".05" value={opacity} onChange={e=>setOpacity(Number(e.target.value))}/></label>
        <div className="liveSwitchRow"><span>Caixas delimitadoras</span><button className={"liveSwitch"+(showBoxes?" on":"")} role="switch" aria-checked={showBoxes} onClick={()=>setShowBoxes(v=>!v)}><i/></button></div>
        <div className="liveSwitchRow"><span>Estabilizar máscaras</span><button className={"liveSwitch"+(smoothing?" on":"")} role="switch" aria-checked={smoothing} onClick={()=>{setSmoothing(v=>!v);emaRef.current=new Map()}}><i/></button></div>
        <div className="liveSwitchRow"><span><ImageDown size={13}/> Salvar cada captura no dispositivo</span><button className={"liveSwitch"+(autoSave?" on":"")} role="switch" aria-checked={autoSave} onClick={()=>setAutoSave(v=>!v)}><i/></button></div>
        <div className="liveSwitchRow"><span><MapPin size={13}/> Georreferenciar{geo?" · ±"+Math.round(geo.accuracy_m)+" m":""}</span><button className={"liveSwitch"+(geoOn?" on":"")} role="switch" aria-checked={geoOn} onClick={()=>setGeoOn(v=>!v)}><i/></button></div>
        <label className="liveLabel">Resolução da câmera
          <select value={resolution} disabled={recording} onChange={e=>{setResolution(e.target.value);if(source?.kind==="camera")startCamera({resolution:e.target.value})}}>{Object.keys(RESOLUTIONS).map(k=><option key={k}>{k}</option>)}</select>
        </label>
        {devices.length>1&&<label className="liveLabel">Câmera
          <select value={deviceId} disabled={recording} onChange={e=>{setDeviceId(e.target.value);startCamera({deviceId:e.target.value})}}><option value="">Automática ({facing==="environment"?"traseira":"frontal"})</option>{devices.map(d=><option key={d.id} value={d.id}>{d.label}</option>)}</select>
        </label>}
        <div className="livePanelActions">
          <button disabled={recording} onClick={()=>{setPanel(null);fileInputRef.current?.click()}}><FileVideo size={15}/> Analisar arquivo de vídeo</button>
          {source?.kind==="file"&&<button disabled={recording} onClick={()=>startCamera()}><Camera size={15}/> Voltar à câmera</button>}
        </div>
        <p className="liveNote">{stats.resolution?stats.resolution.join(" × ")+" px · ":""}{stats.fps.toFixed(0)} fps · IA {stats.ifps.toFixed(1)}/s. Detecção preliminar no navegador, sem envio de quadros. Atalhos: P foto · R vídeo · Espaço pausa.</p>
      </div>
    </aside>}

    {panel==="gallery"&&<aside className="livePanel wide" aria-label="Capturas da sessão">
      <header><b>Capturas da sessão</b>{captures.length>0&&<button className="liveSaveAll" onClick={()=>saveCaptures(captures)} title={shareSupported?"Salvar todas na galeria do dispositivo":"Baixar todas as capturas"}><ImageDown size={15}/> {shareSupported?"Salvar todas":"Baixar todas"}</button>}<button onClick={()=>setPanel(null)} aria-label="Fechar capturas"><X size={17}/></button></header>
      <div className="livePanelBody">
        {captures.length?<div className="liveGallery">{captures.map(c=><figure key={c.id}>
          {c.kind==="photo"?<img src={c.annotated.url} alt="Captura com detecções"/>:<video src={c.video.url} controls playsInline/>}
          <figcaption>
            <b>{c.kind==="photo"?"Foto":"Vídeo · "+fmtDuration(c.duration)}{c.saved&&<em className="liveSaved"> · salvo</em>}</b>
            <span>{Object.entries(c.counts||{}).filter(([,n])=>n>0).map(([k,n])=>k+" "+n).join(" · ")||"sem achados"}</span>
            <div className="liveGalleryActions">
              <button className="primary" onClick={()=>saveCaptures([c])} title={shareSupported?"Salvar na galeria do dispositivo (Fotos/Galeria)":"Baixar no dispositivo"}><ImageDown size={13}/> {shareSupported?"Salvar na galeria":"Salvar no dispositivo"}</button>
              {c.kind==="photo"?<>
                <button onClick={()=>download(c.annotated.url,c.annotated.name)} title="PNG com camadas e dados da inspeção"><Download size={13}/> Detecções</button>
                <button onClick={()=>download(c.original.url,c.original.name)} title="Quadro original"><Download size={13}/> Original</button>
                <button onClick={()=>download(c.json.url,c.json.name)} title="Metadados e detecções"><FileJson size={13}/> JSON</button>
                <button onClick={()=>analyzeCapture(c)} title="Abrir o quadro original na Análise completa"><ScanSearch size={13}/> Analisar</button>
              </>:<>
                <button onClick={()=>download(c.video.url,c.video.name)}><Video size={13}/> Vídeo</button>
                <button onClick={()=>download(c.json.url,c.json.name)} title="Detecções quadro a quadro"><FileJson size={13}/> Linha do tempo</button>
              </>}
              <button onClick={()=>removeCapture(c.id)} title="Descartar" aria-label="Descartar captura"><Trash2 size={13}/></button>
            </div>
          </figcaption>
        </figure>)}</div>:<p className="liveNote center">Nenhuma captura ainda. Use o obturador para registrar fotos ou vídeos com as detecções.</p>}
      </div>
    </aside>}

    {!detecting&&live&&<button className="liveResume" onClick={()=>setDetecting(true)}><Play size={14}/> Retomar detecção</button>}
  </section>
}
