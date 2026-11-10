// Diagnóstico de adequação da imagem para análise (sem DOM; testável em Node).
// Objetivo: sinalizar condições que geram falsos positivos nos motores — em especial o
// estiramento p2–p98 do CDM-1, que amplifica ruído em superfícies de baixo contraste.

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const LUMA=(r,g,b)=>.299*r+.587*g+.114*b;

function percentileFromHist(hist,total,p){
  const target=total*p/100;let acc=0;
  for(let i=0;i<256;i++){acc+=hist[i];if(acc>=target)return i}
  return 255;
}

// Estatísticas globais + nitidez (variância do Laplaciano) e ruído (Immerkær, 1996).
export function analyzeImageData(imageData){
  const{width:w,height:h,data}=imageData,n=w*h;
  const r=new Uint32Array(256),g=new Uint32Array(256),b=new Uint32Array(256),l=new Uint32Array(256);
  const gray=new Float32Array(n);
  let sumR=0,sumG=0,sumB=0,sumL=0,sumL2=0,sumSat=0;
  for(let i=0,j=0;i<n;i++,j+=4){
    const R=data[j],G=data[j+1],B=data[j+2],L=LUMA(R,G,B),li=clamp(Math.round(L),0,255);
    r[R]++;g[G]++;b[B]++;l[li]++;gray[i]=L;
    sumR+=R;sumG+=G;sumB+=B;sumL+=L;sumL2+=L*L;
    const mx=Math.max(R,G,B),mn=Math.min(R,G,B);sumSat+=mx?(mx-mn)/mx:0;
  }
  const mean=sumL/n,std=Math.sqrt(Math.max(0,sumL2/n-mean*mean));
  const p2=percentileFromHist(l,n,2),p50=percentileFromHist(l,n,50),p98=percentileFromHist(l,n,98);
  let clipLow=0,clipHigh=0;for(let i=0;i<=4;i++)clipLow+=l[i];for(let i=251;i<256;i++)clipHigh+=l[i];

  let lapSum=0,lapSum2=0,noiseAcc=0,count=0;
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const i=y*w+x,c=gray[i];
    const lap=gray[i-1]+gray[i+1]+gray[i-w]+gray[i+w]-4*c;
    lapSum+=lap;lapSum2+=lap*lap;
    // Máscara de Immerkær: [1 -2 1; -2 4 -2; 1 -2 1]
    const nm=gray[i-w-1]-2*gray[i-w]+gray[i-w+1]-2*gray[i-1]+4*c-2*gray[i+1]+gray[i+w-1]-2*gray[i+w]+gray[i+w+1];
    noiseAcc+=Math.abs(nm);count++;
  }
  const lapMean=count?lapSum/count:0,sharpness=count?lapSum2/count-lapMean*lapMean:0;
  const noise=count?Math.sqrt(Math.PI/2)*noiseAcc/(6*count):0;
  const mR=sumR/n,mG=sumG/n,mB=sumB/n;
  return{
    width:w,height:h,histogram:{r,g,b,l},
    mean,std,p2,p50,p98,dynamicRange:p98-p2,
    clipLowPct:100*clipLow/n,clipHighPct:100*clipHigh/n,
    sharpness,noise,saturation:sumSat/n,
    channelMeans:[mR,mG,mB],castRG:mG?mR/mG:1,castBG:mG?mB/mG:1
  };
}

const STATUS_RANK={ok:0,warn:1,bad:2};
// Limiares conservadores para fotos de inspeção de concreto. Medidas feitas na imagem reduzida
// a no máx. 1024 px (a mesma ordem de grandeza que os motores usam), então a nitidez é comparável.
export function assessImageQuality(stats,{originalWidth=stats.width,originalHeight=stats.height}={}){
  const checks=[];
  const add=(id,label,status,value,message,fix=null)=>checks.push({id,label,status,value,message,fix});
  const minSide=Math.min(originalWidth,originalHeight);
  add("resolution","Resolução",minSide<480?"bad":minSide<800?"warn":"ok",originalWidth+" × "+originalHeight+" px",
    minSide<480?"Resolução baixa: fissuras finas somem e ruído vira detecção.":minSide<800?"Resolução limitada para fissuras capilares; aproxime a câmera ou use mais pixels.":"Resolução adequada.");
  const sh=stats.sharpness;
  add("sharpness","Nitidez",sh<40?"bad":sh<110?"warn":"ok",sh.toFixed(0)+" (var. Laplaciano)",
    sh<40?"Imagem tremida ou desfocada: bordas borradas geram máscaras largas e falsas.":sh<110?"Nitidez moderada; pode subestimar largura e comprimento de fissuras.":"Foco adequado.",
    sh<110?{sharpen:sh<40?60:35}:null);
  const m=stats.mean;
  const expStatus=(m<30||m>225)?"bad":(m<55||m>200)?"warn":"ok";
  add("exposure","Exposição",expStatus,"média "+m.toFixed(0)+"/255",
    m<55?"Subexposta: sombras são lidas como desplacamento/região escura.":m>200?"Superexposta: eflorescência e fissuras claras se perdem.":"Exposição equilibrada.",
    expStatus!=="ok"?{exposure:clamp(Math.log2(118/Math.max(8,m)),-2,2)}:null);
  const cl=stats.clipLowPct,ch=stats.clipHighPct;
  add("clipping","Recorte de sombras/realces",(cl>20||ch>20)?"bad":(cl>8||ch>8)?"warn":"ok",cl.toFixed(1)+"% / "+ch.toFixed(1)+"%",
    (cl>8||ch>8)?"Pixels saturados não têm informação: detalhes de superfície foram perdidos nessas áreas.":"Sem saturação relevante.");
  const dr=stats.dynamicRange;
  add("dynamic_range","Faixa dinâmica (p2–p98)",dr<40?"bad":dr<75?"warn":"ok",dr.toFixed(0)+" níveis",
    dr<40?"Contraste muito baixo: o CDM-1 estica p2–p98 e amplifica o ruído, gerando fissuras falsas em toda a superfície.":dr<75?"Contraste baixo: maior risco de falsos positivos em motores morfológicos.":"Contraste suficiente.",
    dr<75?{contrast:dr<40?35:20,sCurve:dr<40?45:30}:null);
  const nz=stats.noise;
  add("noise","Ruído",nz>14?"bad":nz>7?"warn":"ok","σ ≈ "+nz.toFixed(1),
    nz>14?"Ruído alto (ISO elevado/pouca luz): grão vira candidato a fissura.":nz>7?"Ruído perceptível; prefira mais luz ou ISO menor.":"Ruído baixo.",
    nz>7?{denoise:nz>14?55:30}:null);
  const cast=Math.max(Math.abs(stats.castRG-1),Math.abs(stats.castBG-1));
  add("color_cast","Balanço de branco",cast>.25?"bad":cast>.12?"warn":"ok","R/G "+stats.castRG.toFixed(2)+" · B/G "+stats.castBG.toFixed(2),
    cast>.12?"Dominante de cor: tons quentes podem ser lidos como corrosão; frios, como eflorescência.":"Cores neutras.",
    cast>.12?{whiteBalance:true}:null);

  const worst=checks.reduce((acc,c)=>STATUS_RANK[c.status]>STATUS_RANK[acc]?c.status:acc,"ok");
  const penalty=checks.reduce((acc,c)=>acc+(c.status==="bad"?25:c.status==="warn"?8:0),0);
  const fix={};for(const c of checks)if(c.fix)Object.assign(fix,c.fix);
  // Com ruído, aumentar contraste/curva S amplifica o grão (o próprio mecanismo do falso positivo):
  // a correção automática prioriza reduzir ruído e compensa o ganho de exposição.
  const noisy=checks.find(c=>c.id==="noise")?.status!=="ok";
  if(noisy){delete fix.contrast;delete fix.sCurve;fix.denoise=clamp(Math.round((fix.denoise||30)+25*Math.max(0,fix.exposure||0)),0,85)}
  const status=id=>checks.find(c=>c.id===id)?.status;
  const recapture=(status("noise")==="bad"&&status("dynamic_range")==="bad")||status("sharpness")==="bad"||status("resolution")==="bad";
  return{
    verdict:worst,score:clamp(100-penalty,0,100),checks,autoFix:fix,recapture,
    recaptureMessage:recapture?"A correção não recupera informação ausente (foco, resolução ou superfície sem contraste e com ruído). Recomenda-se refazer a foto com mais luz, câmera estável e mais próxima.":"",
    label:worst==="ok"?"Adequada para análise":worst==="warn"?"Adequada com ressalvas":"Inadequada: alto risco de falsos positivos"
  };
}
