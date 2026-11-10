import React,{useEffect,useMemo,useRef,useState}from"react";
import{AlertTriangle,CheckCircle2,RotateCcw,RotateCw,Save,Sparkles,Wand2,X,XCircle}from"lucide-react";
import{analyzeImageData,assessImageQuality}from"./imageQuality.js";
import{NEUTRAL_CORRECTION,applyCorrection,describeCorrection,isNeutralCorrection,toneCurve}from"./imageCorrection.js";

const ANALYSIS_SIDE=1024,PREVIEW_SIDE=1400,EXPORT_SIDE=4096;
const VERDICT={ok:{icon:CheckCircle2,cls:"ok"},warn:{icon:AlertTriangle,cls:"warn"},bad:{icon:XCircle,cls:"bad"}};

async function decodeImage(file,maxSide){
  const bmp=await createImageBitmap(file,{imageOrientation:"from-image"});
  const k=Math.min(1,maxSide/Math.max(bmp.width,bmp.height)),w=Math.max(1,Math.round(bmp.width*k)),h=Math.max(1,Math.round(bmp.height*k));
  const c=document.createElement("canvas");c.width=w;c.height=h;const ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(bmp,0,0,w,h);
  const out={image:ctx.getImageData(0,0,w,h),originalWidth:bmp.width,originalHeight:bmp.height};bmp.close?.();return out;
}
function toCanvas(img){const c=document.createElement("canvas");c.width=img.width;c.height=img.height;c.getContext("2d").putImageData(new ImageData(img.data,img.width,img.height),0,0);return c}
function downscale(img,maxSide){
  const k=Math.min(1,maxSide/Math.max(img.width,img.height));if(k===1)return img;
  const w=Math.round(img.width*k),h=Math.round(img.height*k),c=document.createElement("canvas");c.width=w;c.height=h;
  const ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(toCanvas(img),0,0,w,h);return ctx.getImageData(0,0,w,h);
}
const fmtBytes=b=>b>=1048576?(b/1048576).toFixed(2)+" MB":(b/1024).toFixed(1)+" KB";
function gcd(a,b){return b?gcd(b,a%b):a}

// Histograma (luminância preenchida + canais RGB) com a curva tonal em S sobreposta.
function HistogramChart({stats,after,params}){
  const ref=useRef(null);
  useEffect(()=>{
    const c=ref.current;if(!c||!stats)return;
    const dpr=window.devicePixelRatio||1,W=c.clientWidth||288,H=c.clientHeight||132;c.width=W*dpr;c.height=H*dpr;
    const ctx=c.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
    ctx.fillStyle="#f6f9fa";ctx.fillRect(0,0,W,H);
    ctx.strokeStyle="#e3eaed";ctx.lineWidth=1;for(let i=1;i<4;i++){const x=Math.round(W*i/4)+.5,y=Math.round(H*i/4)+.5;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}
    const draw=(hist,style,fill)=>{
      let max=1;for(let i=2;i<254;i++)max=Math.max(max,Math.sqrt(hist[i]));
      ctx.beginPath();ctx.moveTo(0,H);
      for(let i=0;i<256;i++){const x=i/255*W,y=H-Math.min(1,Math.sqrt(hist[i])/max)*(H-6);ctx.lineTo(x,y)}
      if(fill){ctx.lineTo(W,H);ctx.closePath();ctx.fillStyle=style;ctx.fill()}else{ctx.strokeStyle=style;ctx.lineWidth=1;ctx.stroke()}
    };
    const src=after||stats;
    draw(src.histogram.l,"rgba(38,62,75,.16)",true);
    draw(src.histogram.r,"rgba(214,69,80,.65)");draw(src.histogram.g,"rgba(23,140,90,.65)");draw(src.histogram.b,"rgba(45,110,200,.65)");
    if(after){draw(stats.histogram.l,"rgba(38,62,75,.45)")}
    for(const p of [src.p2,src.p98]){const x=p/255*W;ctx.strokeStyle="#c8904f";ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();ctx.setLineDash([])}
    ctx.strokeStyle="#9fb1ba";ctx.setLineDash([2,4]);ctx.beginPath();ctx.moveTo(0,H);ctx.lineTo(W,0);ctx.stroke();ctx.setLineDash([]);
    const f=toneCurve(params);ctx.strokeStyle="#0d766e";ctx.lineWidth=2;ctx.beginPath();
    for(let i=0;i<=64;i++){const x=i/64,y=f(x);i?ctx.lineTo(x*W,H-y*H):ctx.moveTo(x*W,H-y*H)}ctx.stroke();
  },[stats,after,params]);
  return <canvas ref={ref} className="imgHist" aria-label="Histograma RGB e luminância com a curva tonal (curva S)"/>;
}

function Slider({label,value,min,max,step=1,format=v=>v,onChange}){
  return <label className="imgSlider"><span>{label}<b>{format(value)}</b></span><input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))} onDoubleClick={()=>onChange(label==="Gama"?1:0)}/></label>;
}

export default function ImageInspector({file,open,tab="histogram",onTab,onClose,onPreview,onApplyCorrection,onRestoreOriginal,hasOriginal=false,appliedCorrection=null,onDiagnostics,onRename=null,onSave=null}){
  const[base,setBase]=useState(null);// {image(1024), preview(1400), originalWidth, originalHeight}
  const[error,setError]=useState("");
  const[params,setParams]=useState(NEUTRAL_CORRECTION);
  const[after,setAfter]=useState(null);
  const[applying,setApplying]=useState(false);
  const[nameDraft,setNameDraft]=useState(file?.name||"");
  useEffect(()=>{setNameDraft(file?.name||"")},[file?.name]);
  const stats=useMemo(()=>base?analyzeImageData(base.image):null,[base]);
  const quality=useMemo(()=>stats?assessImageQuality(stats,{originalWidth:base.originalWidth,originalHeight:base.originalHeight}):null,[stats,base]);
  const afterQuality=useMemo(()=>after?assessImageQuality(after,{originalWidth:base?.originalWidth,originalHeight:base?.originalHeight}):null,[after,base]);

  useEffect(()=>{
    let cancelled=false;setBase(null);setAfter(null);setParams(NEUTRAL_CORRECTION);setError("");onPreview?.(null);
    if(!file)return;
    decodeImage(file,PREVIEW_SIDE).then(({image,originalWidth,originalHeight})=>{
      if(cancelled)return;setBase({preview:image,image:downscale(image,ANALYSIS_SIDE),originalWidth,originalHeight});
    }).catch(e=>!cancelled&&setError("Não foi possível ler a imagem: "+String(e?.message||e)));
    return()=>{cancelled=true};
  },[file]);// eslint-disable-line react-hooks/exhaustive-deps

  useEffect(()=>{if(quality)onDiagnostics?.({quality,stats:{mean:stats.mean,std:stats.std,dynamic_range:stats.dynamicRange,sharpness:stats.sharpness,noise:stats.noise,clip_low_pct:stats.clipLowPct,clip_high_pct:stats.clipHighPct,cast_rg:stats.castRG,cast_bg:stats.castBG}})},[quality]);// eslint-disable-line react-hooks/exhaustive-deps

  // Pré-visualização ao vivo da correção no canvas principal.
  useEffect(()=>{
    if(!base)return;
    if(isNeutralCorrection(params)){setAfter(null);onPreview?.(null);return}
    const t=setTimeout(()=>{
      const corrected=applyCorrection(base.preview,params),c=toCanvas(corrected);
      onPreview?.(c.toDataURL("image/jpeg",.9));
      setAfter(analyzeImageData(downscale(corrected,ANALYSIS_SIDE)));
    },110);
    return()=>clearTimeout(t);
  },[params,base]);// eslint-disable-line react-hooks/exhaustive-deps

  async function apply(){
    if(!file||isNeutralCorrection(params))return;
    setApplying(true);
    try{
      const{image}=await decodeImage(file,EXPORT_SIDE),out=toCanvas(applyCorrection(image,params));
      const png=/png$/i.test(file.type)||/\.png$/i.test(file.name),type=png?"image/png":"image/jpeg";
      const blob=await new Promise((res,rej)=>out.toBlob(b=>b?res(b):rej(new Error("Falha ao gerar imagem corrigida.")),type,.95));
      const stem=String(file.name||"inspecao").replace(/\.[^.]+$/,"").replace(/-corrigida$/,"");
      const next=new File([blob],stem+"-corrigida."+(png?"png":"jpg"),{type,lastModified:Date.now()});
      onApplyCorrection?.(next,{params:{...params},description:describeCorrection(params),applied_at:new Date().toISOString(),
        quality_before:{verdict:quality?.verdict,score:quality?.score},quality_after:{verdict:afterQuality?.verdict,score:afterQuality?.score},
        source_name:file.name,output_size:[out.width,out.height]});
      setParams(NEUTRAL_CORRECTION);
    }catch(e){setError(String(e?.message||e))}
    finally{setApplying(false)}
  }

  if(!open)return null;
  const set=(k,v)=>setParams(p=>({...p,[k]:v}));
  const V=quality?VERDICT[quality.verdict]:null,shown=afterQuality||quality;
  const aspect=base?(()=>{const g=gcd(base.originalWidth,base.originalHeight);const a=base.originalWidth/g,b=base.originalHeight/g;return a<=32?a+":"+b:(base.originalWidth/base.originalHeight).toFixed(2)+":1"})():"—";
  return <aside className="imgInspector" aria-label="Imagem: histograma, propriedades, qualidade e correção">
    <header>
      <b>Imagem</b>
      {V&&<span className={"imgVerdict "+V.cls} title={quality.label}><V.icon size={13}/>{quality.score}</span>}
      <button onClick={onClose} aria-label="Fechar painel da imagem"><X size={16}/></button>
    </header>
    <nav className="imgTabs" role="tablist">
      {[["histogram","Histograma"],["properties","Propriedades"],["quality","Qualidade"],["correction","Correção"]].map(([k,l])=><button key={k} role="tab" aria-selected={tab===k} className={tab===k?"on":""} onClick={()=>onTab?.(k)}>{l}</button>)}
    </nav>
    <div className="imgBody">
      {error&&<p className="imgError" role="alert">{error}</p>}
      {!stats&&!error&&<p className="imgMuted">Lendo a imagem…</p>}
      {stats&&tab==="histogram"&&<>
        <HistogramChart stats={stats} after={after} params={params}/>
        <div className="imgLegend"><span><i className="l"/>Luminância</span><span><i className="r"/>R</span><span><i className="g"/>G</span><span><i className="b"/>B</span><span><i className="s"/>Curva S</span><span><i className="p"/>p2/p98</span></div>
        <dl className="imgStats">
          <div><dt>Média</dt><dd>{(after||stats).mean.toFixed(0)}</dd></div>
          <div><dt>Desvio</dt><dd>{(after||stats).std.toFixed(1)}</dd></div>
          <div><dt>Faixa p2–p98</dt><dd>{(after||stats).p2}–{(after||stats).p98}</dd></div>
          <div><dt>Sombras/realces</dt><dd>{(after||stats).clipLowPct.toFixed(1)}% / {(after||stats).clipHighPct.toFixed(1)}%</dd></div>
        </dl>
        {after&&<p className="imgMuted">Mostrando a imagem corrigida; a linha escura é a luminância original.</p>}
      </>}
      {stats&&tab==="properties"&&<form className="imgRename" onSubmit={e=>{e.preventDefault();if(nameDraft.trim()&&nameDraft.trim()!==file?.name)onRename?.(nameDraft.trim())}}>
        <label htmlFor="imgFileName">Nome do arquivo</label>
        <div><input id="imgFileName" value={nameDraft} onChange={e=>setNameDraft(e.target.value)} spellCheck="false"/>
        <button type="submit" disabled={!nameDraft.trim()||nameDraft.trim()===file?.name}>Renomear</button>
        <button type="button" className="imgPrimary" onClick={()=>{const n=nameDraft.trim();const f=n&&n!==file?.name?onRename?.(n):file;onSave?.(f||file)}} title="Baixar o arquivo com este nome e atualizar o histórico"><Save size={13}/> Salvar</button></div>
      </form>}
      {stats&&tab==="properties"&&<dl className="imgProps">
        <div><dt>Formato</dt><dd>{file?.type||"—"}</dd></div>
        <div><dt>Tamanho</dt><dd>{fmtBytes(file?.size||0)}</dd></div>
        <div><dt>Resolução</dt><dd>{base.originalWidth} × {base.originalHeight} px</dd></div>
        <div><dt>Megapixels</dt><dd>{(base.originalWidth*base.originalHeight/1e6).toFixed(2)} MP</dd></div>
        <div><dt>Proporção</dt><dd>{aspect}</dd></div>
        <div><dt>Modificado</dt><dd>{file?.lastModified?new Date(file.lastModified).toLocaleString("pt-BR"):"—"}</dd></div>
        <div><dt>Nitidez</dt><dd>{stats.sharpness.toFixed(0)}</dd></div>
        <div><dt>Ruído σ</dt><dd>{stats.noise.toFixed(1)}</dd></div>
        <div><dt>Saturação média</dt><dd>{(100*stats.saturation).toFixed(0)}%</dd></div>
        <div><dt>R/G · B/G</dt><dd>{stats.castRG.toFixed(2)} · {stats.castBG.toFixed(2)}</dd></div>
        {appliedCorrection&&<div className="wide"><dt>Correção aplicada</dt><dd>{appliedCorrection.description}</dd></div>}
      </dl>}
      {quality&&tab==="quality"&&<>
        <div className={"imgVerdictCard "+V.cls}><V.icon size={18}/><div><b>{shown.label}</b><span>Nota {shown.score}/100{afterQuality?" após correção (antes "+quality.score+")":""}</span></div></div>
        {quality.recapture&&<p className="imgRecapture">{quality.recaptureMessage}</p>}
        <ul className="imgChecks">{shown.checks.map(c=><li key={c.id} className={c.status}><i/><div><b>{c.label}<small>{c.value}</small></b><span>{c.message}</span></div></li>)}</ul>
        {Object.keys(quality.autoFix).length>0&&<button className="imgPrimary" onClick={()=>{setParams({...NEUTRAL_CORRECTION,...quality.autoFix});onTab?.("correction")}}><Wand2 size={14}/> Correção sugerida</button>}
        <p className="imgMuted">Diagnóstico a {ANALYSIS_SIDE} px. Imagens inadequadas geram falsos positivos (sombras viram desplacamento, ruído vira fissura, dominante quente vira corrosão).</p>
      </>}
      {stats&&tab==="correction"&&<>
        <div className="imgCorrectionTop">
          <button onClick={()=>setParams({...NEUTRAL_CORRECTION,...quality.autoFix})} disabled={!Object.keys(quality.autoFix).length}><Sparkles size={13}/> Automática</button>
          <button onClick={()=>set("rotate",(params.rotate+270)%360)} title="Girar 90° à esquerda" aria-label="Girar à esquerda"><RotateCcw size={14}/></button>
          <button onClick={()=>set("rotate",(params.rotate+90)%360)} title="Girar 90° à direita" aria-label="Girar à direita"><RotateCw size={14}/></button>
          <button onClick={()=>setParams(NEUTRAL_CORRECTION)} disabled={isNeutralCorrection(params)}>Zerar</button>
        </div>
        <Slider label="Exposição" value={params.exposure} min={-2} max={2} step={.05} format={v=>(v>0?"+":"")+v.toFixed(2)+" EV"} onChange={v=>set("exposure",v)}/>
        <Slider label="Contraste" value={params.contrast} min={-60} max={80} onChange={v=>set("contrast",v)}/>
        <Slider label="Curva S" value={params.sCurve} min={0} max={100} onChange={v=>set("sCurve",v)}/>
        <Slider label="Gama" value={params.gamma} min={.5} max={2} step={.02} format={v=>v.toFixed(2)} onChange={v=>set("gamma",v)}/>
        <Slider label="Saturação" value={params.saturation} min={-100} max={60} onChange={v=>set("saturation",v)}/>
        <Slider label="Redução de ruído" value={params.denoise} min={0} max={85} onChange={v=>set("denoise",v)}/>
        <Slider label="Nitidez" value={params.sharpen} min={0} max={100} onChange={v=>set("sharpen",v)}/>
        <label className="imgCheck"><input type="checkbox" checked={params.whiteBalance} onChange={e=>set("whiteBalance",e.target.checked)}/> Balanço de branco automático (mundo cinza)</label>
        {afterQuality&&<p className={"imgDelta "+afterQuality.verdict}>Qualidade: {quality.score} → <b>{afterQuality.score}</b> · {afterQuality.label}</p>}
        <div className="imgActions">
          <button className="imgPrimary" disabled={isNeutralCorrection(params)||applying} onClick={apply}>{applying?"Aplicando…":"Aplicar à imagem"}</button>
          {hasOriginal&&<button onClick={onRestoreOriginal}>Restaurar original</button>}
        </div>
        <p className="imgMuted">A prévia aparece no canvas. Ao aplicar, a análise usa a imagem corrigida e os ajustes ficam registrados nos metadados.</p>
      </>}
    </div>
  </aside>;
}
