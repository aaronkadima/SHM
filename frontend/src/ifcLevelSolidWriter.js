// Grava o sólido de camadas de nível como IfcSurfaceFeature no próprio arquivo IFC (STEP, ISO 10303-21),
// acrescentando entidades ao fim da seção DATA — nada do modelo original é alterado.
// IFC4X3: PredefinedType .DEFECT. + IfcRelAdheresToElement (relação nova no IFC4x3).
// IFC4:   PredefinedType .USERDEFINED. + ObjectType 'DEFECT' + IfcRelAggregates (não há IfcRelAdheresToElement).
// Geometria: Body / SurfaceModel com um IfcShellBasedSurfaceModel (cascas fechadas) por camada, cada camada com cor.
// Coordenadas: a característica é posicionada relativa ao posicionamento do elemento hospedeiro.

// ---------- leitura STEP mínima ----------
export function parseStep(text){
  const ents=new Map(),re=/#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([\s\S]*?)\);\s*(?=#\d+\s*=|ENDSEC)/g;
  const data=text.slice(text.indexOf("DATA;")+5);let m;
  while((m=re.exec(data)))ents.set(+m[1],{id:+m[1],type:m[2],raw:m[3]});
  const schema=(text.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i)||[])[1]||"";
  return{ents,schema,maxId:Math.max(0,...ents.keys())};
}
// argumentos STEP → árvore: "#12"→{ref:12}, 'txt'→string, .X.→{enum:"X"}, $→null, *→"*", (…)→array, IFCX(…)→{typed,args}
export function parseArgs(raw){
  let i=0;const s=raw;
  const ws=()=>{while(i<s.length&&/\s/.test(s[i]))i++};
  const val=()=>{ws();const c=s[i];
    if(c==="#"){let j=i+1;while(/\d/.test(s[j]))j++;const r={ref:+s.slice(i+1,j)};i=j;return r}
    if(c==="'"){let out="";i++;while(i<s.length){if(s[i]==="'"){if(s[i+1]==="'"){out+="'";i+=2;continue}i++;break}out+=s[i++]}return decodeStepString(out)}
    if(c==="."){const j=s.indexOf(".",i+1);const e=s.slice(i+1,j);i=j+1;return{enum:e}}
    if(c==="$"){i++;return null}if(c==="*"){i++;return"*"}
    if(c==="("){i++;const arr=[];ws();if(s[i]===")"){i++;return arr}while(i<s.length){arr.push(val());ws();if(s[i]===","){i++;continue}if(s[i]===")"){i++;break}}return arr}
    if(/[A-Za-z]/.test(c)){let j=i;while(/[A-Za-z0-9_]/.test(s[j]))j++;const typed=s.slice(i,j).toUpperCase();i=j;ws();const a=val();return{typed,args:Array.isArray(a)?a:[a]}}
    let j=i;while(j<s.length&&/[-+0-9.Ee]/.test(s[j]))j++;const n=parseFloat(s.slice(i,j));i=j;return n};
  const out=[];ws();while(i<s.length){out.push(val());ws();if(s[i]===",")i++;else break}
  return out;
}
export function decodeStepString(t){
  return t.replace(/\\X2\\((?:[0-9A-F]{4})+)\\X0\\/gi,(_,h)=>h.match(/.{4}/g).map(x=>String.fromCharCode(parseInt(x,16))).join("")).replace(/\\X\\([0-9A-F]{2})/gi,(_,h)=>String.fromCharCode(parseInt(h,16))).replace(/\\\\/g,"\\");
}
export function encodeStepString(t){
  let o="";for(const ch of String(t)){const c=ch.codePointAt(0);if(ch==="'")o+="''";else if(ch==="\\")o+="\\\\";else if(c>=32&&c<127)o+=ch;
    else if(c<0x10000)o+="\\X2\\"+c.toString(16).toUpperCase().padStart(4,"0")+"\\X0\\";else o+="?"}
  return"'"+o+"'";
}
const B64="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
export function ifcGuid(){
  const b=new Uint8Array(16);(globalThis.crypto?.getRandomValues?globalThis.crypto.getRandomValues(b):b.forEach((_,i)=>b[i]=Math.random()*256|0));
  b[6]=(b[6]&0x0f)|0x40;b[8]=(b[8]&0x3f)|0x80;let n=0n;for(const x of b)n=(n<<8n)|BigInt(x);
  let s="";for(let k=0;k<22;k++){s=B64[Number(n&63n)]+s;n>>=6n}return s;
}

// ---------- unidades, contexto, posicionamento ----------
const PREFIX={EXA:1e18,PETA:1e15,TERA:1e12,GIGA:1e9,MEGA:1e6,KILO:1e3,HECTO:1e2,DECA:10,DECI:.1,CENTI:.01,MILLI:1e-3,MICRO:1e-6,NANO:1e-9};
export function lengthUnitMeters(M){
  for(const e of M.ents.values()){
    if(e.type==="IFCSIUNIT"){const a=parseArgs(e.raw);if(a[1]?.enum==="LENGTHUNIT")return a[2]?.enum?PREFIX[a[2].enum]??1:1}
  }
  for(const e of M.ents.values())if(e.type==="IFCCONVERSIONBASEDUNIT"){const a=parseArgs(e.raw);if(a[1]?.enum==="LENGTHUNIT"&&a[3]?.ref){const mw=parseArgs(M.ents.get(a[3].ref).raw);const v=mw[0]?.args?.[0];if(typeof v==="number")return v}}
  return 1;
}
function bodyContext(M){
  let sub=null,ctx=null;
  for(const e of M.ents.values()){
    if(e.type==="IFCGEOMETRICREPRESENTATIONSUBCONTEXT"){const a=parseArgs(e.raw);if(String(a[0]).toLowerCase()==="body"&&!sub)sub=e.id}
    if(e.type==="IFCGEOMETRICREPRESENTATIONCONTEXT"&&!ctx){const a=parseArgs(e.raw);if(!a[1]||String(a[1]).toLowerCase()==="model")ctx=e.id}
  }
  return sub||ctx;
}
const I4=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]; // coluna-maior (como three.js)
const mul4=(a,b)=>{const o=new Array(16).fill(0);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o};
const norm=v=>{const l=Math.hypot(...v)||1;return v.map(x=>x/l)},cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
function frameMatrix(o,x,z){x=norm(x);z=norm(z);x=norm(x.map((v,i)=>v-dot(x,z)*z[i]));const y=cross(z,x);return[x[0],x[1],x[2],0,y[0],y[1],y[2],0,z[0],z[1],z[2],0,o[0],o[1],o[2],1]}
export function invertRigid(m){const R=[[m[0],m[4],m[8]],[m[1],m[5],m[9]],[m[2],m[6],m[10]]],t=[m[12],m[13],m[14]];
  const Rt=[[R[0][0],R[1][0],R[2][0]],[R[0][1],R[1][1],R[2][1]],[R[0][2],R[1][2],R[2][2]]],ti=Rt.map(r=>-(r[0]*t[0]+r[1]*t[1]+r[2]*t[2]));
  return[Rt[0][0],Rt[1][0],Rt[2][0],0,Rt[0][1],Rt[1][1],Rt[2][1],0,Rt[0][2],Rt[1][2],Rt[2][2],0,ti[0],ti[1],ti[2],1]}
function axis2Matrix(M,id){
  const e=M.ents.get(id);if(!e)return I4();const a=parseArgs(e.raw),pt=r=>{const c=parseArgs(M.ents.get(r.ref).raw)[0];return[c[0]||0,c[1]||0,c[2]||0]},dir=r=>{const c=parseArgs(M.ents.get(r.ref).raw)[0];return[c[0]||0,c[1]||0,c[2]||0]};
  if(e.type==="IFCAXIS2PLACEMENT3D"){const o=pt(a[0]),z=a[1]?dir(a[1]):[0,0,1],x=a[2]?dir(a[2]):(Math.abs(z[2])<.9?[1,0,0]:[1,0,0]);return frameMatrix(o,Math.abs(dot(norm(x),norm(z)))>.999?[0,1,0]:x,z)}
  if(e.type==="IFCAXIS2PLACEMENT2D"){const o=pt(a[0]),x=a[1]?dir(a[1]):[1,0,0];return frameMatrix([o[0],o[1],0],[x[0],x[1],0],[0,0,1])}
  throw new Error("posicionamento não suportado: "+e.type);
}
// matriz do posicionamento (unidades do modelo); IfcLinearPlacement usa a CartesianPosition guardada (IFC4X3_ADD2)
export function placementMatrix(M,id){
  const e=M.ents.get(id);if(!e)return I4();const a=parseArgs(e.raw);
  if(e.type==="IFCLOCALPLACEMENT"){const rel=a[0]?.ref?placementMatrix(M,a[0].ref):I4();return mul4(rel,axis2Matrix(M,a[1].ref))}
  if(e.type==="IFCLINEARPLACEMENT"){const cp=a[2]?.ref;if(cp)return mul4(a[0]?.ref?placementMatrix(M,a[0].ref):I4(),axis2Matrix(M,cp));throw new Error("IfcLinearPlacement sem CartesianPosition: reexporte o modelo com a posição cartesiana calculada")}
  if(e.type==="IFCGRIDPLACEMENT")throw new Error("IfcGridPlacement não suportado");
  return I4();
}
export function findByGuid(M,guid){for(const e of M.ents.values()){const m=e.raw.match(/^\s*'([^']{22})'/);if(m&&m[1]===guid)return e}return null}

// ---------- gravação ----------
const VIRIDIS=[[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]];
export const levelColor=(k,n)=>{const t=n>1?k/(n-1):1,x=t*(VIRIDIS.length-1),i=Math.min(VIRIDIS.length-2,Math.floor(x)),f=x-i,a=VIRIDIS[i],b=VIRIDIS[i+1];return a.map((v,j)=>(v+(b[j]-v)*f)/255)};
const ringSigned=r=>{let s=0;for(let i=0,j=r.length-1;i<r.length;j=i++)s+=r[j][0]*r[i][1]-r[i][0]*r[j][1];return s/2};

/**
 * stepText: arquivo IFC original; hostGuid: GlobalId do elemento; face: {origin,ex,n} no mundo do modelo (unidades do modelo),
 * com ex = direita na foto e n = normal para fora; ey = n × ex (para cima). solid: buildLevelSolid() em mm no plano da face
 * (u para a direita, v para baixo, origem no canto superior esquerdo do retângulo de referência).
 */
export function writeLevelSolid(stepText,{hostGuid,face,solid,meta={},relief=null,direction=1,cavity=null,voids=true}){
  const M=parseStep(stepText),schema=M.schema.toUpperCase(),is43=schema.startsWith("IFC4X3"),isIfc4=schema==="IFC4"||schema.startsWith("IFC4X1")||schema.startsWith("IFC4X2")||is43;
  if(!isIfc4)throw new Error(`Esquema ${M.schema} não suportado: use IFC4 ou IFC 4.3`);
  const host=findByGuid(M,hostGuid);if(!host)throw new Error("Elemento hospedeiro não encontrado: "+hostGuid);
  const hostArgs=parseArgs(host.raw),hostPl=hostArgs[5]?.ref;if(!hostPl)throw new Error("Elemento hospedeiro sem posicionamento");
  const ctx=bodyContext(M);if(!ctx)throw new Error("Contexto geométrico 'Model/Body' não encontrado");
  const oh=[...M.ents.values()].find(e=>e.type==="IFCOWNERHISTORY")?.id||null;
  const unitM=lengthUnitMeters(M),k=.001/unitM; // mm → unidades do modelo
  const Mh=placementMatrix(M,hostPl),F=frameMatrix(face.origin,face.ex,face.n),Rl=mul4(invertRigid(Mh),F);
  let id=M.maxId;const lines=[],add=s=>{id++;lines.push(`#${id}=${s};`);return id},ref=i=>i==null?"$":"#"+i,num=v=>{const r=Math.abs(v)<1e-12?0:v;const s=(+r.toPrecision(12)).toString();return /[.eE]/.test(s)?s.replace(/e/,"E"):s+"."};
  const P3=(x,y,z)=>add(`IFCCARTESIANPOINT((${num(x)},${num(y)},${num(z)}))`),D3=(x,y,z)=>add(`IFCDIRECTION((${num(x)},${num(y)},${num(z)}))`);
  const name=meta.name||"Dano CDM-4",cls=meta.className||"Desplacamento",n=solid.levels.length,offset=(meta.offsetMm??.5),isCavity=!!cavity?.regions?.length,dir=isCavity||direction<0?-1:1,isRelief=!isCavity&&!!relief?.regions?.length,cut=isCavity&&voids!==false;
  // estilos por nível (reaproveitados por todas as regiões)
  const styles=solid.levels.map((t,i)=>{const[r,g,b]=levelColor(i,n),col=add(`IFCCOLOURRGB($,${num(r)},${num(g)},${num(b)})`),sh=add(`IFCSURFACESTYLESHADING(${ref(col)},${num(.15)})`);
    return add(`IFCSURFACESTYLE(${encodeStepString("CDM-4 nível "+String(t).replace(".",","))},.BOTH.,(${ref(sh)}))`)});
  const features=[],summary=[];
  const reliefById=new Map((relief?.regions||[]).map(r=>[r.id,r])),cavityById=new Map((cavity?.regions||[]).map(r=>[r.id,r]));
  const regionsOut=isCavity?solid.regions.filter(R=>cavityById.has(R.id)):isRelief?solid.regions.filter(R=>reliefById.has(R.id)):solid.regions;
  // malha triangulada (mm no plano da face: u, v para baixo, profundidade para dentro) → IfcTriangulatedFaceSet em unidades do modelo.
  // orient: "volume" = normais para fora do volume (fechada); "up" = normais para fora da face (superfície aberta)
  const faceSet=(P,I,{closed,zSign,zOff=0,orient})=>{const nv=P.length/3,co=new Float64Array(nv*3);
    for(let v=0;v<nv;v++){co[v*3]=P[v*3]*k;co[v*3+1]=-P[v*3+1]*k;co[v*3+2]=zSign*(P[v*3+2]+zOff)*k}
    let acc=0;for(let t=0;t<I.length;t+=3){const a=I[t]*3,b=I[t+1]*3,c=I[t+2]*3;
      if(orient==="volume")acc+=co[a]*(co[b+1]*co[c+2]-co[b+2]*co[c+1])-co[a+1]*(co[b]*co[c+2]-co[b+2]*co[c])+co[a+2]*(co[b]*co[c+1]-co[b+1]*co[c]);
      else acc+=(co[b]-co[a])*(co[c+1]-co[a+1])-(co[b+1]-co[a+1])*(co[c]-co[a])}
    const flip=acc<0,tri=[];for(let t=0;t<I.length;t+=3)tri.push(flip?`(${I[t]+1},${I[t+2]+1},${I[t+1]+1})`:`(${I[t]+1},${I[t+1]+1},${I[t+2]+1})`);
    const pts=[];for(let v=0;v<nv;v++)pts.push(`(${num(co[v*3])},${num(co[v*3+1])},${num(co[v*3+2])})`);
    const pl=add(`IFCCARTESIANPOINTLIST3D((${pts.join(",")})${is43?",$":""})`);return add(`IFCTRIANGULATEDFACESET(${ref(pl)},$,${closed?".T.":".F."},(${tri.join(",")}),$)`)};
  const colourMap=(fs,band)=>{const cl=add(`IFCCOLOURRGBLIST((${solid.levels.map((_,i)=>{const c=levelColor(i,n);return`(${num(c[0])},${num(c[1])},${num(c[2])})`}).join(",")}))`);
    add(`IFCINDEXEDCOLOURMAP(${ref(fs)},$,${ref(cl)},(${Array.from(band,b=>b+1).join(",")}))`);add(`IFCSTYLEDITEM(${ref(fs)},(${ref(styles[Math.floor((n-1)/2)])}),$)`)}; // cor de reserva: nível do meio (para visualizadores sem mapa de cores)
  const voidStyle=cut?(()=>{const c=add("IFCCOLOURRGB($,0.62,0.66,0.68)"),sh=add(`IFCSURFACESTYLESHADING(${ref(c)},0.)`);return add(`IFCSURFACESTYLE('CDM-4 recorte',.BOTH.,(${ref(sh)}))`)})():null;
  const voidsOut=[];
  for(const R of regionsOut){
    const items=[];let repType="SurfaceModel";
    let cav=null;
    if(isCavity){
      // côncavo: o fundo da cavidade (superfície aberta, colorida por faixa) é a característica de superfície;
      // o volume a remover vai num IfcVoidingFeature separado (abaixo) — a geometria do elemento não é alterada
      cav=cavityById.get(R.id);const fs=faceSet(cav.lining.positions,cav.lining.indices,{closed:false,zSign:-1,orient:"up"});
      colourMap(fs,cav.lining.band);items.push(fs);repType="Tessellation";
    }else if(isRelief){
      // relevo contínuo: uma IfcTriangulatedFaceSet fechada, cores por faixa de nível (IfcIndexedColourMap)
      const M3=reliefById.get(R.id),P=M3.positions,I=M3.indices,nv=P.length/3,co=new Float64Array(nv*3);
      for(let v=0;v<nv;v++){co[v*3]=P[v*3]*k;co[v*3+1]=-P[v*3+1]*k;co[v*3+2]=dir*(P[v*3+2]+offset)*k}
      let vol=0;for(let t=0;t<I.length;t+=3){const a=I[t]*3,b=I[t+1]*3,c=I[t+2]*3;vol+=co[a]*(co[b+1]*co[c+2]-co[b+2]*co[c+1])-co[a+1]*(co[b]*co[c+2]-co[b+2]*co[c])+co[a+2]*(co[b]*co[c+1]-co[b+1]*co[c])}
      const flip=vol<0,tri=[];for(let t=0;t<I.length;t+=3)tri.push(flip?`(${I[t]+1},${I[t+2]+1},${I[t+1]+1})`:`(${I[t]+1},${I[t+1]+1},${I[t+2]+1})`);
      const pts=[];for(let v=0;v<nv;v++)pts.push(`(${num(co[v*3])},${num(co[v*3+1])},${num(co[v*3+2])})`);
      const pl=add(`IFCCARTESIANPOINTLIST3D((${pts.join(",")})${is43?",$":""})`),fs=add(`IFCTRIANGULATEDFACESET(${ref(pl)},$,.T.,(${tri.join(",")}),$)`);
      const cl=add(`IFCCOLOURRGBLIST((${solid.levels.map((_,i)=>{const c=levelColor(i,n);return`(${num(c[0])},${num(c[1])},${num(c[2])})`}).join(",")}))`);
      add(`IFCINDEXEDCOLOURMAP(${ref(fs)},$,${ref(cl)},(${Array.from(M3.band,b=>b+1).join(",")}))`);
      add(`IFCSTYLEDITEM(${ref(fs)},(${ref(styles[Math.floor((n-1)/2)])}),$)`);items.push(fs);repType="Tessellation";
    }else R.layers.forEach((L,li)=>{
      const lvIdx=solid.levels.indexOf(L.level),shells=[];
      for(const poly of L.polys){
        // anéis em coordenadas locais (u, −v): externo anti-horário, furos horários
        const toL=r=>r.map(([u,v])=>[u*k,-v*k]);let outer=toL(poly.outer);if(ringSigned(outer)<0)outer.reverse();
        const holes=poly.holes.map(toL).map(h=>ringSigned(h)>0?h.reverse():h);
        // para fora: z de z0 a z1; para dentro: espelhado (topo = mais perto da face)
        const z0=(dir>0?L.z0+offset:-(L.z1+offset))*k,z1=(dir>0?L.z1+offset:-(L.z0+offset))*k,rings=[outer,...holes];
        const pts=rings.map(r=>({b:r.map(([x,y])=>P3(x,y,z0)),t:r.map(([x,y])=>P3(x,y,z1))}));
        const faces=[];
        const loop=ids=>add(`IFCPOLYLOOP((${ids.map(ref).join(",")}))`);
        faces.push(add(`IFCFACE((${[add(`IFCFACEOUTERBOUND(${ref(loop(pts[0].t))},.T.)`),...pts.slice(1).map(p=>add(`IFCFACEBOUND(${ref(loop(p.t))},.T.)`))].map(ref).join(",")}))`));
        faces.push(add(`IFCFACE((${[add(`IFCFACEOUTERBOUND(${ref(loop([...pts[0].b].reverse()))},.T.)`),...pts.slice(1).map(p=>add(`IFCFACEBOUND(${ref(loop([...p.b].reverse()))},.T.)`))].map(ref).join(",")}))`));
        for(const p of pts)for(let i=0;i<p.b.length;i++){const j=(i+1)%p.b.length;faces.push(add(`IFCFACE((${ref(add(`IFCFACEOUTERBOUND(${ref(loop([p.b[i],p.b[j],p.t[j],p.t[i]]))},.T.)`))}))`))}
        shells.push(add(`IFCCLOSEDSHELL((${faces.map(ref).join(",")}))`));
      }
      const sbsm=add(`IFCSHELLBASEDSURFACEMODEL((${shells.map(ref).join(",")}))`);items.push(sbsm);
      add(`IFCSTYLEDITEM(${ref(sbsm)},(${ref(styles[lvIdx])}),$)`);
    });
    const rep=add(`IFCSHAPEREPRESENTATION(${ref(ctx)},'Body','${repType}',(${items.map(ref).join(",")}))`),pds=add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${ref(rep)}))`);
    const ax=add(`IFCAXIS2PLACEMENT3D(${ref(P3(Rl[12],Rl[13],Rl[14]))},${ref(D3(Rl[8],Rl[9],Rl[10]))},${ref(D3(Rl[0],Rl[1],Rl[2]))})`),lp=add(`IFCLOCALPLACEMENT(${ref(hostPl)},${ref(ax)})`);
    const styleTxt=isCavity?(cavity.style==="relief"?"cavidade com vales":"cavidade em degraus"):isRelief?"relevo contínuo":`${R.layers.length} camadas de nível`,dirTxt=dir>0?"para fora da face":"para dentro da face";
    const label=`${name} R${R.id}`,desc=`${cls}: forma aproximada (${styleTxt}, ${dirTxt}; altura proporcional ao potencial, ${solid.layerMm} mm por nível; não é profundidade)`;
    const sf=add(`IFCSURFACEFEATURE(${encodeStepString(ifcGuid())},${ref(oh)},${encodeStepString(label)},${encodeStepString(desc)},${is43?"$":"'DEFECT'"},${ref(lp)},${ref(pds)},$,${is43?".DEFECT.":".USERDEFINED."})`);
    features.push(sf);
    // conjunto de propriedades (nome sem o prefixo reservado Pset_)
    const prop=(nm,type,v)=>add(`IFCPROPERTYSINGLEVALUE(${encodeStepString(nm)},$,${type}(${typeof v==="string"?encodeStepString(v):num(v)}),$)`);
    const base=R.areaByLevel[0]?.area_mm2||0,props=[
      prop("Representacao","IFCTEXT","Forma aproximada do dano para identificação visual; altura = nível do potencial × espessura da camada, não é profundidade"),
      prop("Motor","IFCLABEL","CDM-4 (random walker, fluxo por evidência)"),prop("Estilo","IFCLABEL",isCavity?(cavity.style==="relief"?"cavidade com vales":"cavidade em degraus"):isRelief?"relevo contínuo (com vales)":"camadas planas"),prop("Sentido","IFCLABEL",dirTxt),
      ...(isCavity?[prop("Recorte","IFCLABEL",cut?"IfcVoidingFeature + IfcRelVoidsElement (geometria do elemento inalterada; apagar o recorte restaura a vista original)":"sem recorte")]:[]),prop("Classe","IFCLABEL",cls),
      prop("Niveis","IFCLABEL",solid.levels.map(v=>String(v).replace(".",",")).join("; ")),prop("EspessuraCamada_mm","IFCREAL",solid.layerMm),
      prop("AreaNivelBase_m2","IFCREAL",+(base/1e6).toFixed(6)),
      ...R.areaByLevel.map(a=>prop("Area_u"+String(a.level).replace(".","_")+"_m2","IFCREAL",+(a.area_mm2/1e6).toFixed(6))),
      ...(meta.image?[prop("Imagem","IFCLABEL",meta.image)]:[]),...(meta.scale?[prop("Escala","IFCLABEL",meta.scale)]:[]),
      ...(meta.date?[prop("DataInspecao","IFCLABEL",meta.date)]:[])];
    const ps=add(`IFCPROPERTYSET(${encodeStepString(ifcGuid())},${ref(oh)},'CDM_DamageShape',$,(${props.map(ref).join(",")}))`);
    let vf=null;
    if(cut){
      // volume do recorte: um IfcExtrudedAreaSolid por polígono de cada degrau (perfil com furos), da tampa 1 mm fora da face até
      // a profundidade do degrau — forma que os motores booleanos dos visualizadores processam de forma robusta
      const cap=cavity.capMm??1,dn=add("IFCDIRECTION((0.,0.,-1.))"),posAt=new Map(),solids=[];
      const pos=top=>{const key=num(top);if(!posAt.has(key))posAt.set(key,add(`IFCAXIS2PLACEMENT3D(${ref(P3(0,0,-top*k))},$,$)`));return posAt.get(key)};
      const curve=r=>{const pts=r.map(([u,v])=>add(`IFCCARTESIANPOINT((${num(u*k)},${num(-v*k)}))`));return add(`IFCPOLYLINE((${[...pts,pts[0]].map(ref).join(",")}))`)};
      for(const st of cav.steps)for(const pg of st.polys){if(pg.outer.length<3)continue;
        const prof=pg.holes.length?add(`IFCARBITRARYPROFILEDEFWITHVOIDS(.AREA.,$,${ref(curve(pg.outer))},(${pg.holes.map(h=>ref(curve(h))).join(",")}))`):add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${ref(curve(pg.outer))})`);
        const top=st.topMm??-cap;solids.push(add(`IFCEXTRUDEDAREASOLID(${ref(prof)},${ref(pos(top))},${ref(dn)},${num((st.depthMm-top)*k)})`))}
      for(const x of solids)add(`IFCSTYLEDITEM(${ref(x)},(${ref(voidStyle)}),$)`);
      const vrep=add(`IFCSHAPEREPRESENTATION(${ref(ctx)},'Body','SweptSolid',(${solids.map(ref).join(",")}))`),vpds=add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${ref(vrep)}))`);
      const vlp=add(`IFCLOCALPLACEMENT(${ref(hostPl)},${ref(ax)})`);
      vf=add(`IFCVOIDINGFEATURE(${encodeStepString(ifcGuid())},${ref(oh)},${encodeStepString(`Recorte ${label}`)},${encodeStepString(`${cls}: volume removido só para visualização da forma aproximada do dano (não é profundidade medida)`)},'DEFECT',${ref(vlp)},${ref(vpds)},$,.USERDEFINED.)`);
      add(`IFCRELVOIDSELEMENT(${encodeStepString(ifcGuid())},${ref(oh)},'CDM-4 recorte',$,${ref(host.id)},${ref(vf)})`);voidsOut.push(vf);
    }
    add(`IFCRELDEFINESBYPROPERTIES(${encodeStepString(ifcGuid())},${ref(oh)},$,$,(${[sf,vf].filter(Boolean).map(ref).join(",")}),${ref(ps)})`);
    summary.push({region:R.id,feature:sf,layers:R.layers.length,area_m2:base/1e6,style:isCavity?"cavity":isRelief?"relief":"terraces",void:vf});
  }
  if(features.length){
    if(is43)add(`IFCRELADHERESTOELEMENT(${encodeStepString(ifcGuid())},${ref(oh)},'CDM-4 danos',$,${ref(host.id)},(${features.map(ref).join(",")}))`);
    else if(cut){
      // IFC4 com recorte: cada fundo colorido é agregado ao seu IfcVoidingFeature (o defeito contém o revestimento). Agregá-lo
      // ao elemento faria visualizadores como o web-ifc aplicarem o recorte também ao fundo, que está dentro do vazio.
      summary.forEach(x=>add(`IFCRELAGGREGATES(${encodeStepString(ifcGuid())},${ref(oh)},'CDM-4 dano',$,${ref(x.void)},(${ref(x.feature)}))`));
    }else add(`IFCRELAGGREGATES(${encodeStepString(ifcGuid())},${ref(oh)},'CDM-4 danos',$,${ref(host.id)},(${features.map(ref).join(",")}))`);
  }
  const end=stepText.lastIndexOf("ENDSEC;");if(end<0)throw new Error("Arquivo IFC sem seção DATA");
  const out=stepText.slice(0,end)+lines.join("\n")+"\n"+stepText.slice(end);
  return{text:out,voids:voidsOut.length,schema:M.schema,relation:is43?"IfcRelAdheresToElement":cut?"IfcRelAggregates (recorte → fundo)":"IfcRelAggregates",predefinedType:is43?"DEFECT":"USERDEFINED (ObjectType DEFECT)",features:summary,newEntities:lines.length,unitMeters:unitM};
}
