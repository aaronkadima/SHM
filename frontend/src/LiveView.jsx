import React,{useCallback,useEffect,useMemo,useRef,useState}from"react";
import{Activity,Camera,Circle,Download,FileJson,FileVideo,Flashlight,MapPin,Pause,Play,ScanSearch,Square,SwitchCamera,Trash2,Video,VideoOff}from"lucide-react";
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
function safeSlug(v){return String(v||"").trim().replace(/[^\w.-]+/g,"_").slice(0,40)}

export default function LiveView({engines=[],selected=[],cdmOptions={},inspectionMeta={},appInfo={},onAnalyzeFrame,onNavigate}){
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

  const videoRef=useRef(null),canvasRef=useRef(null),workCanvasRef=useRef(null),fileInputRef=useRef(null);
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

  const flash=useCallback((text,ms=1800)=>{setNotice(text);clearTimeout(flash.t);flash.t=setTimeout(()=>setNotice(""),ms)},[]);

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

  const startCamera=useCallback(async(opts={})=>{
    if(!navigator.mediaDevices?.getUserMedia){setStreamState({status:"error",error:"Câmera indisponível neste navegador ou fora de conexão HTTPS."});return}
    if(recorderRef.current?.state==="recording"){flash("Pare a gravação antes de trocar a fonte.");return}
    stopSource();setStreamState({status:"starting",error:""});
    const[w,h]=RESOLUTIONS[opts.resolution||resolution]||RESOLUTIONS["1080p"];
    const dev=opts.deviceId??deviceId,face=opts.facing||facing;
    const video={width:{ideal:w},height:{ideal:h},frameRate:{ideal:30}};
    if(dev)video.deviceId={exact:dev};else video.facingMode={ideal:face};
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video,audio:false});
      streamRef.current=stream;
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
      const msg=name==="NotAllowedError"?"Permissão de câmera negada. Libere o acesso nas configurações do navegador.":name==="NotFoundError"?"Nenhuma câmera encontrada.":name==="OverconstrainedError"?"A câmera não aceita essa resolução; tente uma menor.":String(error?.message||error);
      setStreamState({status:"error",error:msg});
    }
  },[deviceId,facing,resolution,stopSource,requestWakeLock,flash]);

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
      drawComposite(canvas.getContext("2d"),W,H);
      frameCountRef.current.display++;
      const s=settingsRef.current,now=performance.now();
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
  },[drawComposite,sendFrame]);

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
    setCaptures(list=>[item,...list]);flash("Foto capturada");
  },[drawComposite,metadataFor,flash]);

  // ---------- Gravação de vídeo ----------
  const canRecord=typeof MediaRecorder!=="undefined"&&typeof HTMLCanvasElement!=="undefined"&&!!HTMLCanvasElement.prototype.captureStream;
  const startRecording=useCallback(()=>{
    const canvas=canvasRef.current,v=videoRef.current;
    if(!v?.videoWidth){flash("Inicie uma fonte de vídeo primeiro.");return}
    if(!canRecord){flash("Gravação de vídeo não suportada neste navegador.",3000);return}
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
      setCaptures(list=>[{id:crypto.randomUUID(),kind:"video",base,createdAt:Date.now(),duration,
        video:{blob,url:URL.createObjectURL(blob),name:base+"-deteccoes."+ext},
        json:{blob:jsonBlob,url:URL.createObjectURL(jsonBlob),name:base+"-linha-do-tempo.json"},counts:totals},...list]);
      setRecording(false);setRecElapsed(0);flash("Vídeo salvo na sessão");
    };
    rec.start(1000);recorderRef.current=rec;recStartRef.current=performance.now();setRecording(true);
  },[canRecord,metadataFor,flash]);
  const stopRecording=useCallback(()=>{if(recorderRef.current?.state==="recording")recorderRef.current.stop()},[]);

  useEffect(()=>{
    const onKey=e=>{
      if(e.target?.closest?.("input,select,textarea"))return;
      if(e.key==="p"||e.key==="P"){e.preventDefault();takePhoto()}
      else if(e.key==="r"||e.key==="R"){e.preventDefault();recorderRef.current?.state==="recording"?stopRecording():startRecording()}
      else if(e.key===" "){e.preventDefault();setDetecting(d=>!d)}
    };
    window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey);
  },[takePhoto,startRecording,stopRecording]);

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
  const countEntries=Object.entries(stats.counts||{});
  return <section className="viewPage liveView">
    <div className="viewHead">
      <div><span>ENTRADA VISUAL · TEMPO REAL</span><h2>Modo Live</h2><p>Detecção de patologias quadro a quadro no próprio navegador. Nenhum quadro é enviado a servidores.</p></div>
      <div className="viewActions">
        <button onClick={()=>onNavigate?.("analysis")}><Activity size={14}/> Análise</button>
      </div>
    </div>
    <div className="liveGrid">
      <article className="surface liveStage">
        <div className="liveViewport">
          <video ref={videoRef} playsInline muted autoPlay className="liveVideoSource"/>
          <canvas ref={canvasRef} className={"liveCanvas"+(live?"":" hidden")} aria-label="Vídeo com detecções em tempo real"/>
          {!live&&<div className="liveEmpty">
            {streamState.status==="starting"?<><Camera size={30}/><b>Iniciando fonte…</b></>:<>
              <Camera size={30}/><b>Nenhuma fonte ativa</b>
              <p>Use a câmera do dispositivo ou um vídeo gravado (por exemplo, voo de drone sob a OAE).</p>
              <div className="liveEmptyActions">
                <button className="primary" onClick={()=>startCamera()}><Camera size={15}/> Iniciar câmera</button>
                <button onClick={()=>fileInputRef.current?.click()}><FileVideo size={15}/> Abrir vídeo</button>
              </div>
            </>}
            {streamState.error&&<p className="liveError" role="alert">{streamState.error}</p>}
          </div>}
          {live&&<div className="liveBadges">
            <span className={"liveBadge "+(detecting&&engineState.status==="ready"?"on":"off")}><i/>{detecting?(engineState.status==="ready"?"DETECTANDO":engineState.status==="error"?"ERRO NO MOTOR":"CARREGANDO "+Math.round(engineState.progress)+"%"):"PAUSADO"}</span>
            {recording&&<span className="liveBadge rec"><i/>REC {fmtDuration(recElapsed)}</span>}
            <span className="liveBadge info">{stats.fps.toFixed(0)} fps · IA {stats.ifps.toFixed(1)}/s{stats.latency!=null?" · "+Math.round(stats.latency)+" ms":""}</span>
          </div>}
          {notice&&<div className="liveNotice" role="status">{notice}</div>}
        </div>
        <input ref={fileInputRef} hidden type="file" accept="video/*" onChange={e=>{const f=e.target.files?.[0];e.target.value="";startFile(f)}}/>
        <div className="liveControls">
          <button className="liveShutter" disabled={!live} onClick={takePhoto} title="Capturar foto com detecções (P)"><Camera size={18}/><span>Foto</span></button>
          {recording
            ?<button className="liveRecord active" onClick={stopRecording} title="Parar gravação (R)"><Square size={16}/><span>Parar</span></button>
            :<button className="liveRecord" disabled={!live||!canRecord} onClick={startRecording} title={canRecord?"Gravar vídeo com detecções (R)":"Gravação não suportada neste navegador"}><Circle size={16}/><span>Gravar</span></button>}
          <button disabled={!live} onClick={()=>setDetecting(d=>!d)} title="Pausar/retomar detecção (Espaço)">{detecting?<Pause size={16}/>:<Play size={16}/>}<span>{detecting?"Pausar IA":"Retomar IA"}</span></button>
          {source?.kind==="camera"&&devices.length>1&&<button disabled={recording} onClick={()=>{const next=facing==="environment"?"user":"environment";setFacing(next);setDeviceId("");startCamera({facing:next,deviceId:""})}} title="Alternar câmera"><SwitchCamera size={16}/><span>Alternar</span></button>}
          {torch.supported&&<button className={torch.on?"active":""} onClick={toggleTorch} title="Lanterna"><Flashlight size={16}/><span>Luz</span></button>}
          {live&&<button disabled={recording} onClick={stopSource} title="Encerrar fonte"><VideoOff size={16}/><span>Encerrar</span></button>}
        </div>
      </article>

      <aside className="liveSide">
        <article className="surface">
          <div className="surfaceHead"><div><b>MOTOR</b><span>Motores browser-ready com suporte ao Live</span></div><span className={"statusPill "+(engineState.status==="ready"?"success":engineState.status==="error"?"danger":"neutral")}>{engineState.status==="ready"?"PRONTO":engineState.status==="error"?"ERRO":"CARREGANDO"}</span></div>
          <div className="liveField">
            <select value={engineId} disabled={recording} onChange={e=>setEngineId(e.target.value)} aria-label="Motor de detecção">
              {liveEngines.map(e=><option key={e.id} value={e.id}>{e.catalog?.name||e.name}</option>)}
            </select>
            <small>{engineMeta?.note}</small>
            {engineState.status==="loading"&&<div className="liveProgress"><i style={{width:Math.max(4,engineState.progress)+"%"}}/></div>}
            {engineState.error&&<p className="liveError" role="alert">{engineState.error}</p>}
          </div>
          <div className="liveField"><label>Taxa máxima de inferência <b>{fpsCap} quadros/s</b></label><input type="range" min="1" max="20" value={fpsCap} onChange={e=>setFpsCap(Number(e.target.value))}/></div>
          {engineId==="yolov8n_public_crack_seg"&&<div className="liveField"><label>Confiança mínima <b>{Math.round(confidence*100)}%</b></label><input type="range" min=".05" max=".9" step=".05" value={confidence} onChange={e=>setConfidence(Number(e.target.value))}/></div>}
          {engineId==="cdm_1"&&<small className="liveHint">Usa os parâmetros CDM-1 de Configurações (limiar {cdmOptions.cdm_threshold??35}), com kernel e área mínima escalados para a resolução do Live.</small>}
        </article>

        <article className="surface">
          <div className="surfaceHead"><div><b>ACHADOS NO QUADRO</b><span>{stats.resolution?stats.resolution.join(" × ")+" px":"—"}</span></div></div>
          <div className="liveCounts">
            {countEntries.length?countEntries.map(([k,n])=><div key={k} className={n?"has":""}><span>{k}</span><b>{n}</b></div>):<div className="compactEmpty">{live?(detecting?"Aguardando primeiro resultado…":"Detecção pausada."):"Inicie uma fonte de vídeo."}</div>}
          </div>
        </article>

        <article className="surface">
          <div className="surfaceHead"><div><b>VISUALIZAÇÃO & FONTE</b></div></div>
          <div className="liveField"><label>Opacidade das camadas <b>{Math.round(opacity*100)}%</b></label><input type="range" min=".1" max="1" step=".05" value={opacity} onChange={e=>setOpacity(Number(e.target.value))}/></div>
          <label className="liveCheck"><input type="checkbox" checked={showBoxes} onChange={e=>setShowBoxes(e.target.checked)}/> Caixas delimitadoras</label>
          <label className="liveCheck"><input type="checkbox" checked={smoothing} onChange={e=>{setSmoothing(e.target.checked);emaRef.current=new Map()}}/> Estabilização temporal das máscaras</label>
          <label className="liveCheck"><input type="checkbox" checked={geoOn} onChange={e=>setGeoOn(e.target.checked)}/> <MapPin size={13}/> Georreferenciar capturas{geo?" (±"+Math.round(geo.accuracy_m)+" m)":""}</label>
          <div className="liveField"><label>Resolução da câmera</label>
            <select value={resolution} disabled={recording} onChange={e=>{setResolution(e.target.value);if(source?.kind==="camera")startCamera({resolution:e.target.value})}}>{Object.keys(RESOLUTIONS).map(k=><option key={k}>{k}</option>)}</select>
          </div>
          {devices.length>1&&<div className="liveField"><label>Dispositivo</label>
            <select value={deviceId} disabled={recording} onChange={e=>{setDeviceId(e.target.value);startCamera({deviceId:e.target.value})}}><option value="">Automático ({facing==="environment"?"traseira":"frontal"})</option>{devices.map(d=><option key={d.id} value={d.id}>{d.label}</option>)}</select>
          </div>}
          <div className="liveSourceButtons">
            <button disabled={recording} onClick={()=>startCamera()}><Camera size={14}/> Câmera</button>
            <button disabled={recording} onClick={()=>fileInputRef.current?.click()}><FileVideo size={14}/> Vídeo</button>
          </div>
          <small className="liveHint">Atalhos: <kbd>P</kbd> foto · <kbd>R</kbd> gravar · <kbd>Espaço</kbd> pausar IA. Metadados de OAE/elemento vêm de Configurações.</small>
        </article>
      </aside>
    </div>

    <article className="surface liveCaptures">
      <div className="surfaceHead"><div><b>CAPTURAS DA SESSÃO</b><span>{captures.length?captures.length+" item(ns) · ficam na memória até sair da página":"Fotos e vídeos aparecem aqui"}</span></div></div>
      {captures.length?<div className="liveCaptureGrid">{captures.map(c=><figure key={c.id} className="liveCapture">
        {c.kind==="photo"?<img src={c.annotated.url} alt="Captura com detecções"/>:<video src={c.video.url} controls playsInline/>}
        <figcaption>
          <b>{c.kind==="photo"?"Foto":"Vídeo · "+fmtDuration(c.duration)}</b>
          <span>{Object.entries(c.counts||{}).filter(([,n])=>n>0).map(([k,n])=>k+" "+n).join(" · ")||"sem achados"}</span>
          <div className="liveCaptureActions">
            {c.kind==="photo"?<>
              <button onClick={()=>download(c.annotated.url,c.annotated.name)} title="PNG com camadas e HUD"><Download size={13}/> Detecções</button>
              <button onClick={()=>download(c.original.url,c.original.name)} title="Quadro original sem sobreposição"><Download size={13}/> Original</button>
              <button onClick={()=>download(c.json.url,c.json.name)} title="Metadados e detecções"><FileJson size={13}/> JSON</button>
              <button className="primary" onClick={()=>analyzeCapture(c)} title="Abrir o quadro original na Análise completa"><ScanSearch size={13}/> Analisar</button>
            </>:<>
              <button onClick={()=>download(c.video.url,c.video.name)}><Video size={13}/> Vídeo</button>
              <button onClick={()=>download(c.json.url,c.json.name)} title="Detecções quadro a quadro"><FileJson size={13}/> Linha do tempo</button>
            </>}
            <button onClick={()=>removeCapture(c.id)} title="Descartar" aria-label="Descartar captura"><Trash2 size={13}/></button>
          </div>
        </figcaption>
      </figure>)}</div>:<div className="compactEmpty">Nenhuma captura ainda.</div>}
    </article>
  </section>
}
