// CDM-4 · correções da IA de contexto (validadas em 20 fotos reais de inspeção).
//  F1 — classes ambíguas de terreno/água (ADE20K) cercadas pela estrutura viram neutras: o modelo
//       confunde concreto desplacado, úmido ou manchado com "earth", "sand", "water"…; uma região
//       dessas que não toca a borda da foto está dentro da peça e não pode apagar o dano.
//  F4 — céu superexposto (R, G e B ≥ 245, ligado à borda da foto) entra na exclusão: o SegFormer
//       nem sempre o marca como "sky", e o estiramento de contraste o transforma em eflorescência.
// Determinístico: varreduras em largura, sem limiar aprendido.

export const AMBIGUOUS_TERRAIN=new Set(["earth","land","sand","dirt track","mountain","hill","water","sea","river","lake","waterfall","field"]);

function labelOf(names,c){return String(names?.[c]??"").toLowerCase().split(/[,;]/)[0].trim()}

// F1: devolve uma cópia da máscara de exclusão com as regiões ambíguas fechadas zeradas.
export function neutralizeEnclosedTerrain(ctx){
  const{w,h,cls,names}=ctx,mask=new Uint8Array(ctx.mask),n=w*h;
  if(!cls||!names)return{mask,neutralized_cells:0};
  const amb=new Uint8Array(n);for(let i=0;i<n;i++)amb[i]=AMBIGUOUS_TERRAIN.has(labelOf(names,cls[i]))?1:0;
  const seen=new Uint8Array(n),q=new Int32Array(n);let neutral=0;
  for(let s=0;s<n;s++){
    if(seen[s]||!amb[s])continue;
    let hd=0,tl=0,border=false;q[tl++]=s;seen[s]=1;
    while(hd<tl){
      const p=q[hd++],y=(p/w)|0,x=p-y*w;
      if(x===0||y===0||x===w-1||y===h-1)border=true;
      if(x>0&&!seen[p-1]&&amb[p-1]){seen[p-1]=1;q[tl++]=p-1}
      if(x<w-1&&!seen[p+1]&&amb[p+1]){seen[p+1]=1;q[tl++]=p+1}
      if(y>0&&!seen[p-w]&&amb[p-w]){seen[p-w]=1;q[tl++]=p-w}
      if(y<h-1&&!seen[p+w]&&amb[p+w]){seen[p+w]=1;q[tl++]=p+w}
    }
    if(!border)for(let k=0;k<tl;k++){if(mask[q[k]])neutral++;mask[q[k]]=0}
  }
  return{mask,neutralized_cells:neutral};
}

// F4: céu superexposto ligado à borda, na resolução da imagem.
export function overexposedSky(rgba,w,h,minValue=245){
  const n=w*h,sky=new Uint8Array(n),q=new Int32Array(n);let hd=0,tl=0;
  const bright=i=>rgba[4*i]>=minValue&&rgba[4*i+1]>=minValue&&rgba[4*i+2]>=minValue;
  const seed=i=>{if(!sky[i]&&bright(i)){sky[i]=1;q[tl++]=i}};
  for(let x=0;x<w;x++){seed(x);seed((h-1)*w+x)}
  for(let y=0;y<h;y++){seed(y*w);seed(y*w+w-1)}
  while(hd<tl){
    const p=q[hd++],y=(p/w)|0,x=p-y*w;
    if(x>0)seed(p-1);if(x<w-1)seed(p+1);if(y>0)seed(p-w);if(y<h-1)seed(p+w);
  }
  return{mask:sky,pixels:tl};
}
