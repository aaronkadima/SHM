import React,{useEffect,useMemo,useState}from"react";
import{Upload,Play,CheckCircle2,AlertTriangle,Clock3,Layers3,Server,Save,Wifi,WifiOff}from"lucide-react";

const BUILD_API=(import.meta.env.VITE_API_URL||"https://shm-api-production-01f8.up.railway.app").replace(/\/$/,"");
const txt={ok:"Concluído",missing_dependency:"Dependência ausente",missing_weights:"Pesos ausentes",error:"Erro",skipped:"Registrado"};

function initialApi(){
  const q=new URLSearchParams(location.search).get("api");
  const stored=localStorage.getItem("shmApiUrl");
  const v=(q||stored||BUILD_API||"").replace(/\/$/,"");
  if(q){localStorage.setItem("shmApiUrl",v);history.replaceState({},document.title,location.pathname)}
  return v;
}

function Card({r}){return <article className="card"><div className="head"><div><h3>{r.name}</h3><span className={"badge "+r.status}>{txt[r.status]||r.status}</span></div><span className="lat"><Clock3 size={14}/>{r.latency_ms.toFixed(0)} ms</span></div>{r.overlay_png_base64?<img src={"data:image/png;base64,"+r.overlay_png_base64}/>:<div className="empty">{r.message||"Sem visualização"}</div>}<div className="metrics"><b>{r.detections.length}</b> achados {Object.entries(r.metrics||{}).slice(0,4).map(([k,v])=><span key={k}>{k}: {String(v)}</span>)}</div>{r.message&&<p className="msg">{r.message}</p>}</article>}

export default function App(){
 const[api,setApi]=useState(initialApi),[apiDraft,setApiDraft]=useState(initialApi),[online,setOnline]=useState(false);
 const[eng,setEng]=useState([]),[sel,setSel]=useState(new Set()),[file,setFile]=useState(null),[prev,setPrev]=useState(null),[res,setRes]=useState(null),[busy,setBusy]=useState(false),[err,setErr]=useState("");

 async function loadEngines(base=api){
   setErr("");setOnline(false);
   if(!base){setEng([]);setSel(new Set());return}
   try{
     const hr=await fetch(base+"/health",{signal:AbortSignal.timeout(12000)});
     if(!hr.ok)throw new Error("Backend respondeu "+hr.status);
     const r=await fetch(base+"/engines",{signal:AbortSignal.timeout(20000)});
     if(!r.ok)throw new Error(await r.text());
     const x=await r.json();setEng(x);setSel(new Set(x.map(e=>e.id)));setOnline(true);
   }catch(e){setEng([]);setSel(new Set());setErr("Backend indisponível: "+String(e))}
 }
 useEffect(()=>{loadEngines(api)},[api]);
 useEffect(()=>()=>{if(prev)URL.revokeObjectURL(prev)},[prev]);
 const ready=useMemo(()=>eng.filter(e=>e.ready).length,[eng]);
 function saveApi(){const v=apiDraft.trim().replace(/\/$/,"");localStorage.setItem("shmApiUrl",v);setApi(v)}
 function pick(f){setFile(f);setRes(null);if(prev)URL.revokeObjectURL(prev);setPrev(f?URL.createObjectURL(f):null)}
 function toggle(id){setSel(s=>{let n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n})}
 async function run(){
   if(!file||!api)return;setBusy(true);setErr("");let fd=new FormData();fd.append("file",file);fd.append("engines",[...sel].join(","));
   try{let r=await fetch(api+"/compare",{method:"POST",body:fd});if(!r.ok)throw new Error(await r.text());setRes(await r.json())}
   catch(e){setErr(String(e))}finally{setBusy(false)}
 }
 return <main>
   <header><div><div className="eye"><Layers3 size={16}/> SHM · OAEs · COMPUTER VISION</div><h1>SHM Vision Lab</h1><p>Uma imagem. Vários motores. Resultados normalizados lado a lado.</p></div><div className="sum"><b>{eng.length}</b><span>motores</span><b>{ready}</b><span>prontos</span></div></header>

   <section className="apiBar">
     <div className="apiTitle"><Server size={18}/><div><b>Backend de inferência</b><span>{online?<><Wifi size={13}/> Online</>:<><WifiOff size={13}/> Não conectado</>}</span></div></div>
     <input value={apiDraft} onChange={e=>setApiDraft(e.target.value)} placeholder="https://seu-backend.up.railway.app"/>
     <button onClick={saveApi}><Save size={16}/> Conectar</button>
   </section>

   {!api&&<div className="notice">A interface está publicada no GitHub Pages. Informe uma vez a URL do backend online acima; ela ficará salva neste navegador.</div>}

   <section className="work"><div className="left"><label className="drop"><input type="file" accept="image/*" onChange={e=>pick(e.target.files?.[0])}/>{prev?<img src={prev}/>:<><Upload size={34}/><b>Selecionar imagem da inspeção</b><span>JPG, PNG ou WEBP</span></>}</label><button className="run" disabled={!file||busy||!sel.size||!online} onClick={run}><Play size={18}/>{busy?"Processando...":"Executar comparação"}</button>{err&&<div className="error">{err}</div>}</div><div className="panel"><div className="pt"><h2>Motores</h2><button onClick={()=>setSel(new Set(eng.map(e=>e.id)))}>Selecionar todos</button></div><div className="elist">{eng.length?eng.map(e=><label className="engine" key={e.id}><input type="checkbox" checked={sel.has(e.id)} onChange={()=>toggle(e.id)}/><div><b>{e.name}</b><span>{e.family} · {e.task.replaceAll("_"," ")}</span><small>{e.description}</small>{!e.ready&&e.reason&&<small className="reason">{e.reason}</small>}</div>{e.ready?<CheckCircle2 className="ok" size={18}/>:<AlertTriangle className="warn" size={18}/>}</label>):<div className="engineEmpty">Conecte o backend online para carregar os motores.</div>}</div></div></section>
   {res&&<section className="results"><h2>Comparação</h2><p>{res.image_width} × {res.image_height}px · mesma entrada para todos os motores</p><div className="grid">{res.results.map(r=><Card key={r.engine_id} r={r}/>)}</div></section>}
 </main>
}
