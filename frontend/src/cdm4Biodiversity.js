// Refinamento de contorno por biodiversidade local (índices ecológicos de Ataky, 2022) — usado pelo CDM-4.
//
// Ideia: a degradação é uma evolução de cor e de textura a partir do concreto saudável vizinho.
// Para cada componente de uma família de ÁREA já decidida pelo CDM (desplacamento, corrosão,
// eflorescência), compara-se a "comunidade" de pixels do núcleo do dano com a do concreto
// saudável numa coroa ao redor, e cada pixel de uma faixa estreita em torno da borda é atribuído
// ao grupo mais próximo. O CDM continua decidindo a classe; aqui só se redesenha a borda e se
// testa a evidência (núcleo indistinguível do entorno ⇒ componente descartado).
// Sem treino, sem aleatoriedade: mesma entrada ⇒ mesma saída.
//
// Espécies: nível de luminância (8 classes, entre os percentis 1 e 99 da foto) × matiz oponente
// (6 setores + 1 acromático) = 56 espécies. Por pixel:
//   índices de comunidade (janela WIN): Shannon H', Gini-Simpson 1−Σp², riqueza S, Berger-Parker,
//   distinção taxonômica com pesos de distância ao quadrado (= variância local de L e de croma),
//   cor fina (janela 3×3): média de L e dos dois eixos oponentes.

export const BIO_DEFAULTS={modes:null,decide:"all",margin:1,win:9,coreR:4,ringIn:6,ringOut:30,band:10,minSep:1.0,minRing:60,classes:["spalling_dark","corrosion_rust","efflorescence_white"]};
const NL=8,NH=6,S=NL*(NH+1),CHROMA_MIN=12;
export const BIO_FEATURES=["shannon","gini_simpson","richness","berger_parker","dist_L","dist_chroma","L","o1","o2"];

function boxMean(src,w,h,k){
  const r=k>>1,W=w+1,I=new Float64Array(W*(h+1)),out=new Float32Array(w*h);
  for(let y=0;y<h;y++){let row=0;for(let x=0;x<w;x++){row+=src[y*w+x];I[(y+1)*W+x+1]=I[y*W+x+1]+row}}
  for(let y=0;y<h;y++){const y0=Math.max(0,y-r),y1=Math.min(h-1,y+r);
    for(let x=0;x<w;x++){const x0=Math.max(0,x-r),x1=Math.min(w-1,x+r);
      const s=I[(y1+1)*W+x1+1]-I[y0*W+x1+1]-I[(y1+1)*W+x0]+I[y0*W+x0];
      out[y*w+x]=s/((y1-y0+1)*(x1-x0+1))}}
  return out;
}
function quantile(sorted,q){if(!sorted.length)return 0;const i=q*(sorted.length-1),lo=Math.floor(i),hi=Math.ceil(i);return sorted[lo]+(sorted[hi]-sorted[lo])*(i-lo)}

// Mapa de características (9 planos, já padronizados por mediana/MAD da foto).
export function bioFeatures(rgba,w,h,{win=BIO_DEFAULTS.win}={}){
  const n=w*h,L=new Float32Array(n),o1=new Float32Array(n),o2=new Float32Array(n),sp=new Uint8Array(n);
  for(let i=0,j=0;i<n;i++,j+=4){const r=rgba[j],g=rgba[j+1],b=rgba[j+2];L[i]=.299*r+.587*g+.114*b;o1[i]=r-g;o2[i]=(r+g)/2-b}
  const Ls=Float32Array.from(L).sort(),lo=quantile(Ls,.01),hi=Math.max(lo+1,quantile(Ls,.99));
  for(let i=0;i<n;i++){
    const lb=Math.max(0,Math.min(NL-1,Math.floor((L[i]-lo)/(hi-lo)*NL)));
    const c=Math.hypot(o1[i],o2[i]);let hb=0;
    if(c>=CHROMA_MIN){let a=Math.atan2(o2[i],o1[i]);if(a<0)a+=2*Math.PI;hb=1+Math.min(NH-1,Math.floor(a/(2*Math.PI)*NH))}
    sp[i]=lb*(NH+1)+hb;
  }
  const H=new Float32Array(n),G=new Float32Array(n),R=new Float32Array(n),B=new Float32Array(n),ind=new Uint8Array(n);
  const present=new Uint8Array(S);for(let i=0;i<n;i++)present[sp[i]]=1;
  for(let s=0;s<S;s++){
    if(!present[s])continue;
    for(let i=0;i<n;i++)ind[i]=sp[i]===s?1:0;
    const p=boxMean(ind,w,h,win);
    for(let i=0;i<n;i++){const v=p[i];if(v>0){H[i]-=v*Math.log(v);G[i]+=v*v;R[i]+=1;if(v>B[i])B[i]=v}}
  }
  for(let i=0;i<n;i++)G[i]=1-G[i];
  // distinção taxonômica Δ com w_ij = |v_i−v_j|²  ⇒  2·variância local (fecha a soma sobre pares)
  const chroma=new Float32Array(n);for(let i=0;i<n;i++)chroma[i]=Math.hypot(o1[i],o2[i]);
  const local=(a)=>{const m=boxMean(a,w,h,win),a2=new Float32Array(n);for(let i=0;i<n;i++)a2[i]=a[i]*a[i];const m2=boxMean(a2,w,h,win),sd=new Float32Array(n);for(let i=0;i<n;i++)sd[i]=Math.sqrt(Math.max(0,m2[i]-m[i]*m[i]));return sd};
  const dL=local(L),dC=local(chroma);
  const planes=[H,G,R,B,dL,dC,boxMean(L,w,h,3),boxMean(o1,w,h,3),boxMean(o2,w,h,3)];
  // padronização robusta global (subamostra determinística)
  const step=Math.max(1,Math.floor(n/60000));
  for(const P of planes){
    const s=[];for(let i=0;i<n;i+=step)s.push(P[i]);s.sort((a,b)=>a-b);
    const med=quantile(s,.5),d=s.map(v=>Math.abs(v-med)).sort((a,b)=>a-b),mad=Math.max(1e-6,1.4826*quantile(d,.5));
    for(let i=0;i<n;i++)P[i]=(P[i]-med)/mad;
  }
  return{planes,names:BIO_FEATURES,w,h};
}

// morfologia binária quadrada (separável) em uma janela
function morph(src,w,h,k,isMax){
  const r=k>>1,tmp=new Uint8Array(w*h),out=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=isMax?0:1;for(let d=-r;d<=r;d++){const xx=Math.min(w-1,Math.max(0,x+d)),s=src[y*w+xx];if(isMax?s:!s){v=isMax?1:0;break}}tmp[y*w+x]=v}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=isMax?0:1;for(let d=-r;d<=r;d++){const yy=Math.min(h-1,Math.max(0,y+d)),s=tmp[yy*w+x];if(isMax?s:!s){v=isMax?1:0;break}}out[y*w+x]=v}
  return out;
}
function components(mask,w,h){
  const lab=new Int32Array(w*h),q=new Int32Array(w*h),comps=[];let id=0;
  for(let s=0;s<w*h;s++){if(!mask[s]||lab[s])continue;id++;let hd=0,tl=0,x0=w,y0=h,x1=0,y1=0;q[tl++]=s;lab[s]=id;
    while(hd<tl){const p=q[hd++],y=(p/w)|0,x=p-y*w;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
      for(let ny=Math.max(0,y-1);ny<=Math.min(h-1,y+1);ny++)for(let nx=Math.max(0,x-1);nx<=Math.min(w-1,x+1);nx++){const t=ny*w+nx;if(mask[t]&&!lab[t]){lab[t]=id;q[tl++]=t}}}
    comps.push({id,bbox:[x0,y0,x1,y1],area:tl})}
  return{lab,comps};
}
function robust(planes,idx){
  const med=[],mad=[];
  for(const P of planes){const v=idx.map(i=>P[i]).sort((a,b)=>a-b),m=quantile(v,.5);med.push(m);mad.push(1.4826*quantile(v.map(x=>Math.abs(x-m)).sort((a,b)=>a-b),.5))}
  return{med,mad};
}
function sample(arr,maxN=4000){if(arr.length<=maxN)return arr;const st=arr.length/maxN,o=[];for(let i=0;i<maxN;i++)o.push(arr[Math.floor(i*st)]);return o}

// Refina as máscaras de área. masks: {classe: Uint8Array}; exclusion: Uint8Array (1 = fora da zona de interesse) ou null.
export function bioRefineMasks(masks,feat,{exclusion=null,opts={}}={}){
  const o={...BIO_DEFAULTS,...opts},{w,h,planes}=feat,n=w*h,out={...masks},log=[],K0=o.decide==="fine"?6:0;
  const anyDamage=new Uint8Array(n);for(const m of Object.values(masks))if(m instanceof Uint8Array&&m.length===n)for(let i=0;i<n;i++)if(m[i])anyDamage[i]=1;
  const forbidOf={spalling_dark:["efflorescence_white"],corrosion_rust:["efflorescence_white"],efflorescence_white:["spalling_dark","corrosion_rust","exposed_rebar"]};
  for(const cls of o.classes){
    const m=masks[cls];if(!(m instanceof Uint8Array))continue;
    const forbid=new Uint8Array(n);for(const f of forbidOf[cls]||[]){const fm=masks[f];if(fm)for(let i=0;i<n;i++)if(fm[i])forbid[i]=1}
    const{lab,comps}=components(m,w,h),res=new Uint8Array(n);
    for(const c of comps){
      const pad=o.ringOut+2,X0=Math.max(0,c.bbox[0]-pad),Y0=Math.max(0,c.bbox[1]-pad),X1=Math.min(w-1,c.bbox[2]+pad),Y1=Math.min(h-1,c.bbox[3]+pad),rw=X1-X0+1,rh=Y1-Y0+1;
      const G=(x,y)=>(Y0+y)*w+X0+x,comp=new Uint8Array(rw*rh);
      for(let y=0;y<rh;y++)for(let x=0;x<rw;x++)comp[y*rw+x]=lab[G(x,y)]===c.id?1:0;
      let core=morph(comp,rw,rh,2*o.coreR+1,false);let nc=0;for(const v of core)nc+=v;if(nc<20){core=comp}
      const dIn=morph(comp,rw,rh,2*o.ringIn+1,true),dOut=morph(comp,rw,rh,2*o.ringOut+1,true);
      const ringIdx=[],coreIdx=[];
      for(let y=0;y<rh;y++)for(let x=0;x<rw;x++){const l=y*rw+x,g=G(x,y);
        if(dOut[l]&&!dIn[l]&&!anyDamage[g]&&!(exclusion&&exclusion[g]))ringIdx.push(g);
        if(core[l])coreIdx.push(g)}
      if(ringIdx.length<o.minRing){for(let y=0;y<rh;y++)for(let x=0;x<rw;x++)if(comp[y*rw+x])res[G(x,y)]=1;log.push({cls,bbox:c.bbox,area:c.area,status:"sem_referencia"});continue}
      const hs=robust(planes,sample(ringIdx)),ds=robust(planes,sample(coreIdx));
      const sc=hs.med.map((_,k)=>Math.max(.15,Math.sqrt((hs.mad[k]**2+ds.mad[k]**2)/2)));
      const sep=Math.sqrt(hs.med.reduce((a,_,k)=>a+((ds.med[k]-hs.med[k])/sc[k])**2,0)/hs.med.length);
      if(sep<o.minSep){log.push({cls,bbox:c.bbox,area:c.area,sep:+sep.toFixed(3),status:"descartado"});continue}
      if(o.modes&&o.modes[cls]==="gate"){for(let y=0;y<rh;y++)for(let x=0;x<rw;x++)if(comp[y*rw+x])res[G(x,y)]=1;log.push({cls,bbox:c.bbox,area:c.area,sep:+sep.toFixed(3),status:"mantido"});continue}
      // faixa de decisão em torno da borda
      const db=morph(comp,rw,rh,2*o.band+1,true),eb=morph(comp,rw,rh,2*o.band+1,false),cand=new Uint8Array(rw*rh);
      for(let y=0;y<rh;y++)for(let x=0;x<rw;x++){const l=y*rw+x,g=G(x,y);
        if(eb[l]||core[l]){cand[l]=1;continue}
        if(!db[l]||forbid[g]||(exclusion&&exclusion[g]))continue;
        let dh=0,dd=0;for(let k=K0;k<planes.length;k++){const v=planes[k][g];dh+=((v-hs.med[k])/sc[k])**2;dd+=((v-ds.med[k])/sc[k])**2}
        if(dd*o.margin<dh)cand[l]=1}
      // limpeza 3×3 e conectividade ao núcleo
      const cl=morph(morph(cand,rw,rh,3,true),rw,rh,3,false),op=o.noOpen?cl:morph(morph(cl,rw,rh,3,false),rw,rh,3,true);
      const keep=new Uint8Array(rw*rh),q=new Int32Array(rw*rh);let hd=0,tl=0;
      for(let l=0;l<rw*rh;l++)if(core[l]&&op[l]){keep[l]=1;q[tl++]=l}
      while(hd<tl){const p=q[hd++],y=(p/rw)|0,x=p-y*rw;for(let ny=Math.max(0,y-1);ny<=Math.min(rh-1,y+1);ny++)for(let nx=Math.max(0,x-1);nx<=Math.min(rw-1,x+1);nx++){const t=ny*rw+nx;if(op[t]&&!keep[t]){keep[t]=1;q[tl++]=t}}}
      let na=0;for(let l=0;l<rw*rh;l++)if(keep[l]){res[G(l%rw,(l/rw)|0)]=1;na++}
      log.push({cls,bbox:c.bbox,area:c.area,new_area:na,sep:+sep.toFixed(3),status:"refinado"});
    }
    out[cls]=res;
  }
  // separação de classes preservada: armadura aninhada no desplacamento; corrosão nunca é fissura
  if(out.exposed_rebar&&out.spalling_dark){const s=new Uint8Array(out.spalling_dark);for(let i=0;i<n;i++)if(out.exposed_rebar[i])s[i]=1;out.spalling_dark=s}
  if(out.cracks&&out.corrosion_rust){const c=new Uint8Array(out.cracks);for(let i=0;i<n;i++)if(out.corrosion_rust[i])c[i]=0;out.cracks=c}
  return{masks:out,log};
}

// Canal de evidência por diversidade: superfície que "evoluiu" (agregado exposto, rugosa, com muitas
// espécies de cor) contra a referência saudável da própria foto (formas lisas, poucas espécies).
// Devolve candidatos de desplacamento claro que a regra "escuro" do CDM não vê.
export const DIV_DEFAULTS={win:21,zH:2.5,zS:1.5,closeK:15,openK:9,minAreaFrac:.003,maxAspect:5,minFill:.25};
export function diversityCandidates(feat,{exclusion=null,opts={}}={}){
  const o={...DIV_DEFAULTS,...opts},{w,h,planes}=feat,n=w*h,H=planes[0],Sr=planes[2],m=new Uint8Array(n);
  const rH=o.localRef?localReference(H,w,h,{win:o.refWin||201}):null,rS=o.localRef?localReference(Sr,w,h,{win:o.refWin||201}):null;
  for(let i=0;i<n;i++)m[i]=H[i]-(rH?rH[i]:0)>=o.zH&&Sr[i]-(rS?rS[i]:0)>=o.zS&&!(exclusion&&exclusion[i])?1:0;
  const cl=morph(morph(m,w,h,o.closeK,true),w,h,o.closeK,false),op=morph(morph(cl,w,h,o.openK,false),w,h,o.openK,true);
  const{lab,comps}=components(op,w,h),out=new Uint8Array(n),log=[];
  for(const c of comps){
    const bw=c.bbox[2]-c.bbox[0]+1,bh=c.bbox[3]-c.bbox[1]+1,asp=Math.max(bw,bh)/Math.min(bw,bh),fill=c.area/(bw*bh);
    const ok=c.area>=o.minAreaFrac*n&&asp<=o.maxAspect&&fill>=o.minFill;
    log.push({bbox:c.bbox,area:c.area,aspect:+asp.toFixed(2),fill:+fill.toFixed(2),status:ok?"aceito":"rejeitado"});
    if(ok)for(let y=c.bbox[1];y<=c.bbox[3];y++)for(let x=c.bbox[0];x<=c.bbox[2];x++){const i=y*w+x;if(lab[i]===c.id)out[i]=1}
  }
  return{mask:out,log};
}

export function largestComponent(mask,w,h){if(!mask)return 0;const{comps}=components(mask,w,h);return comps.reduce((m,c)=>Math.max(m,c.area),0)}
// referência saudável LOCAL: média, numa janela grande, só dos pixels abaixo do percentil q do índice
export function localReference(plane,w,h,{win=201,q=.6}={}){
  const n=w*h,st=Math.max(1,Math.floor(n/60000)),s=[];for(let i=0;i<n;i+=st)s.push(plane[i]);s.sort((a,b)=>a-b);
  const cut=quantile(s,q),m=new Float32Array(n),v=new Float32Array(n);
  for(let i=0;i<n;i++)if(plane[i]<=cut){m[i]=1;v[i]=plane[i]}
  const sm=boxMean(m,w,h,win),sv=boxMean(v,w,h,win),ref=new Float32Array(n);
  for(let i=0;i<n;i++)ref[i]=sm[i]>.02?sv[i]/sm[i]:0;
  return ref;
}
