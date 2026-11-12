import React from "react";

// Ilustrações técnicas (SVG) do manual do SHM Studio.
// Cores das camadas iguais às do canvas (cdmBrowser.js · CLASS_COLORS).
export const C={crack:"#e60000",spall:"#ff9900",rebar:"#8c8c8c",rust:"#8b3f00",efflo:"#0066cc",growth:"#00915a",reduction:"#704eaa",ink:"#263e4b",muted:"#7d919b",line:"#c9d6dc",soft:"#eef4f6",teal:"#0d766e"};

function Fig({title,caption,children,viewBox="0 0 640 260",n}){
  return <figure className="umFig">
    <svg viewBox={viewBox} role="img" aria-label={title} xmlns="http://www.w3.org/2000/svg">{children}</svg>
    <figcaption><b>Figura {n}.</b> {caption}</figcaption>
  </figure>;
}
const T=({x,y,children,a="start",s=11,w=400,c=C.ink})=><text x={x} y={y} textAnchor={a} fontSize={s} fontWeight={w} fill={c}>{children}</text>;
const Arrow=({x1,y1,x2,y2,c=C.muted})=>{
  const ang=Math.atan2(y2-y1,x2-x1),h=6;
  const p=`${x2},${y2} ${x2-h*Math.cos(ang-.45)},${y2-h*Math.sin(ang-.45)} ${x2-h*Math.cos(ang+.45)},${y2-h*Math.sin(ang+.45)}`;
  return <g><line x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth="1.5"/><polygon points={p} fill={c}/></g>;
};

// 1 · Anatomia da interface
export function FigInterface({n}){
  const box=(x,y,w,h,label,sub,fill="#fff")=><g><rect x={x} y={y} width={w} height={h} rx="5" fill={fill} stroke={C.line}/><T x={x+8} y={y+16} w={700}>{label}</T>{sub&&<T x={x+8} y={y+30} s={9.5} c={C.muted}>{sub}</T>}</g>;
  return <Fig n={n} title="Anatomia da interface" viewBox="0 0 640 330" caption="Regiões da janela do SHM Studio. O canvas central recebe a imagem; os painéis flutuantes (Imagem, Resultados, Etapas, Paridade) ficam sobre ele e podem ser recolhidos.">
    <rect x="4" y="4" width="632" height="322" rx="8" fill={C.soft} stroke={C.line}/>
    {box(10,10,620,34,"① Barra de menus","Arquivo · Editar · Visualizar · Análise · Ajuda — título do arquivo — ações (Importar, Executar, Salvar)")}
    {box(10,50,44,236,"②","")}
    <T x={18} y={84} s={9} c={C.muted}>ferra-</T><T x={18} y={95} s={9} c={C.muted}>mentas</T>
    {[0,1,2,3,4,5,6,7,8,9].map(i=><rect key={i} x="20" y={108+i*16} width="24" height="11" rx="3" fill="#dbe7eb"/>)}
    <rect x="60" y="50" width="570" height="236" rx="5" fill="#f9fbfb" stroke={C.line}/>
    <rect x="60" y="50" width="570" height="14" fill="#eef3f5"/><rect x="60" y="50" width="14" height="236" fill="#eef3f5"/>
    {Array.from({length:28},(_,i)=><line key={i} x1={74+i*20} y1={i%5===0?52:58} x2={74+i*20} y2="64" stroke={C.muted} strokeWidth=".7"/>)}
    <T x={82} y={224} s={9.5} c={C.muted}>⑦ réguas em mm</T><T x={82} y={236} s={9.5} c={C.muted}>(horizontal e vertical)</T>
    {box(80,72,124,62,"③ Imagem","propriedades, ajustes")}
    {box(80,140,124,62,"④ Resultados","achados por patologia")}
    <path d="M300 120 C340 140 360 170 410 180 S480 220 520 230" stroke={C.crack} strokeWidth="2.4" fill="none"/>
    <rect x="292" y="108" width="236" height="132" fill="none" stroke={C.crack} strokeDasharray="4 3"/>
    <rect x="292" y="95" width="106" height="13" fill={C.crack}/><T x={296} y={106} s={9} c="#fff" w={700}>fissura 1 · 0,21 mm</T>
    <ellipse cx="450" cy="110" rx="34" ry="20" fill={C.spall} fillOpacity=".55" stroke={C.spall}/>
    <T x={430} y={78} s={10} c={C.muted}>⑤ canvas · zoom/pan CAD</T>
    {box(210,232,190,48,"⑥ Etapas do motor","miniaturas por estágio","#fff")}
    {box(470,240,150,40,"Live · Câmera","botões flutuantes")}
    {box(10,292,620,28,"⑧ Barra de status","mensagem de estado, zoom, coordenadas, motor ativo")}
  </Fig>;
}

// 2 · Fluxo do processamento
export function FigPipeline({n}){
  const steps=[["Imagem","PNG/JPG/WebP…"],["Qualidade","nitidez, ruído"],["Tom","exposição, γ"],["Cinza","Y + p2–p98"],["Máscaras","5 classes"],["Famílias","separação"],["Regiões","consolidação"],["Medidas","L, w, área"],["GDE","condição"],["Relatório","CSV/SVG/IFC"]];
  return <Fig n={n} title="Fluxo de processamento" viewBox="0 0 640 150" caption="Cadeia de processamento do motor morfológico CDM 2.10, da imagem importada ao relatório. Com imagem de referência (t0) é acrescido o ramo temporal (registro e diferenças).">
    {steps.map(([a,b],i)=>{const x=6+(i%5)*127,y=i<5?10:84;return <g key={a}>
      <rect x={x} y={y} width="110" height="48" rx="7" fill={i===4||i===8?"#e3f1ee":"#fff"} stroke={i===4||i===8?C.teal:C.line}/>
      <T x={x+55} y={y+21} a="middle" w={700}>{(i+1)+". "+a}</T><T x={x+55} y={y+37} a="middle" s={9.5} c={C.muted}>{b}</T>
      {i%5!==4&&<Arrow x1={x+110} y1={y+24} x2={x+126} y2={y+24}/>}
    </g>})}
    <path d="M616 58 L616 70 L61 70 L61 82" stroke={C.muted} strokeWidth="1.5" fill="none"/><polygon points="61,84 57,76 65,76" fill={C.muted}/>
  </Fig>;
}

// 3 · Perfil black-hat
export function FigBlackHat({n}){
  const xs=Array.from({length:121},(_,i)=>i);
  const I=x=>150-18*Math.sin(x/9)-(Math.abs(x-46)<4?70*(1-Math.abs(x-46)/4):0)-(Math.abs(x-88)<3?45*(1-Math.abs(x-88)/3):0);
  const close=x=>{let m=-1e9;for(let d=-7;d<=7;d++){let mn=1e9;for(let e=-7;e<=7;e++){const t=x+d+e;mn=Math.min(mn,-I(Math.max(0,Math.min(120,t))))}m=Math.max(m,mn)}return -m};
  const sx=x=>40+x*4.6,sy=v=>v*1.0+0;
  const path=f=>xs.map((x,i)=>(i?"L":"M")+sx(x).toFixed(1)+" "+(260-sy(f(x))).toFixed(1)).join(" ");
  const bh=x=>Math.max(0,close(x)-I(x));
  const pathBH=xs.map((x,i)=>(i?"L":"M")+sx(x).toFixed(1)+" "+(250-bh(x)*1.1).toFixed(1)).join(" ");
  return <Fig n={n} title="Perfil black-hat" viewBox="0 0 640 270" caption="Perfil de intensidade ao longo de uma linha da imagem (cinza), seu fechamento morfológico φ(I) com elemento estruturante k (tracejado) e o resíduo black-hat BH = φ(I) − I (em vermelho, abaixo). Vales estreitos — mais finos que k — são as fissuras candidatas; o limiar T as separa do fundo.">
    <line x1="36" y1="10" x2="36" y2="250" stroke={C.line}/><line x1="36" y1="250" x2="610" y2="250" stroke={C.line}/>
    <path d={path(I)} stroke={C.ink} strokeWidth="1.8" fill="none"/>
    <path d={path(close)} stroke={C.teal} strokeWidth="1.6" strokeDasharray="5 4" fill="none"/>
    <path d={pathBH} stroke={C.crack} strokeWidth="1.8" fill="none"/>
    <line x1="36" y1={250-35*1.1} x2="610" y2={250-35*1.1} stroke={C.crack} strokeDasharray="2 3"/>
    <T x={612} y={250-35*1.1+4} s={10} c={C.crack}>T</T>
    <T x={sx(46)} y={226-0} a="middle" s={10} c={C.crack} w={700}>BH &gt; T → fissura</T>
    <T x={sx(88)} y={232} a="middle" s={9.5} c={C.muted}>BH &lt; T → descartado</T>
    <T x={44} y={22} s={10.5} c={C.teal}>φₖ(I) fechamento</T><T x={44} y={36} s={10.5}>I(x) intensidade</T>
    <g transform="translate(470 22)"><rect width="128" height="18" rx="4" fill={C.soft}/><rect x="6" y="6" width={7*4.6*2/4} height="6" fill={C.teal}/><T x={30} y={13} s={9.5}>k = 15 px (padrão)</T></g>
  </Fig>;
}

// 4 · Esqueleto, poda e medidas
export function FigSkeleton({n}){
  return <Fig n={n} title="Esqueleto e medidas da fissura" viewBox="0 0 640 230" caption="À esquerda, a máscara binária da fissura (área A). Ao centro, o esqueleto de Zhang–Suen com um ramo espúrio (≤ 12 px até a junção) removido pela poda. À direita, o caminho simplificado por Ramer–Douglas–Peucker (ε = 0,8 px) usado no comprimento L; a largura média é w = A/L.">
    <g><path d="M20 160 C60 120 100 140 140 90 S190 60 200 40" stroke="#f4a3a3" strokeWidth="16" strokeLinecap="round" fill="none"/>
      <path d="M20 160 C60 120 100 140 140 90 S190 60 200 40" stroke={C.crack} strokeWidth="16" strokeOpacity=".35" strokeLinecap="round" fill="none"/>
      <T x={110} y={200} a="middle" w={700}>máscara · área A</T></g>
    <g transform="translate(215 0)"><path d="M20 160 C60 120 100 140 140 90 S190 60 200 40" stroke="#f4c9c9" strokeWidth="16" strokeLinecap="round" fill="none"/>
      <path d="M20 160 C60 120 100 140 140 90 S190 60 200 40" stroke={C.crack} strokeWidth="1.8" fill="none"/>
      <path d="M96 128 L104 146 L108 154" stroke={C.ink} strokeWidth="1.8" strokeDasharray="3 2" fill="none"/>
      <line x1="92" y1="146" x2="116" y2="138" stroke={C.ink}/><line x1="92" y1="138" x2="116" y2="148" stroke={C.ink}/>
      <T x={128} y={170} s={9.5} c={C.muted}>espúrio ≤ 12 px · podado</T>
      <T x={110} y={200} a="middle" w={700}>esqueleto (1 px)</T></g>
    <g transform="translate(430 0)"><path d="M20 160 C60 120 100 140 140 90 S190 60 200 40" stroke="#f4c9c9" strokeWidth="16" strokeLinecap="round" fill="none"/>
      <polyline points="20,160 62,128 104,124 140,90 176,62 200,40" stroke={C.ink} strokeWidth="1.8" fill="none"/>
      {[[20,160],[62,128],[104,124],[140,90],[176,62],[200,40]].map(([x,y])=><circle key={x} cx={x} cy={y} r="3.4" fill="#fff" stroke={C.ink}/>)}
      <T x={110} y={200} a="middle" w={700}>RDP · L = Σ ‖pᵢ₊₁ − pᵢ‖</T><T x={110} y={216} a="middle" s={10} c={C.muted}>w̄ = A / L</T></g>
  </Fig>;
}

// 5 · Regiões de cor (HSV) para corrosão e eflorescência
export function FigHsv({n}){
  const cx=120,cy=120,r=92,seg=[];
  for(let h=0;h<360;h+=5){const a0=(h-90)*Math.PI/180,a1=(h+5-90)*Math.PI/180;
    seg.push(<path key={h} d={`M${cx} ${cy} L${cx+r*Math.cos(a0)} ${cy+r*Math.sin(a0)} A${r} ${r} 0 0 1 ${cx+r*Math.cos(a1)} ${cy+r*Math.sin(a1)} Z`} fill={`hsl(${h} 80% 52%)`} opacity={h<55||h>=330?1:.22}/>)}
  const arc=(a,b,rr)=>{const p=d=>[cx+rr*Math.cos((d-90)*Math.PI/180),cy+rr*Math.sin((d-90)*Math.PI/180)];const[x0,y0]=p(a),[x1,y1]=p(b);return `M${x0} ${y0} A${rr} ${rr} 0 0 1 ${x1} ${y1}`};
  return <Fig n={n} title="Critérios de cor HSV" viewBox="0 0 640 250" caption="Esquerda: setor de matiz aceito para corrosão (H < 55° ou H > 330°), complementado por R > G + 12, R > B + 18, S > 0,22 e V > 0,16. Direita: plano S × V — a eflorescência ocupa a região clara e pouco saturada (V > 0,72, S < 0,28) e precisa estar acima do percentil 72 de cinza.">
    {seg}<circle cx={cx} cy={cy} r="34" fill="#fff"/>
    <path d={arc(330,415,r+8)} stroke={C.rust} strokeWidth="4" fill="none"/>
    <T x={cx} y={cy+4} a="middle" w={700}>H</T><T x={cx} y={14} a="middle" s={10}>0°</T>
    <T x={cx+r+18} y={cy+4} s={10}>90°</T><T x={cx} y={cy+r+16} a="middle" s={10}>180°</T>
    <T x={cx+40} y={34} s={10} c={C.rust} w={700}>55°</T><T x={cx-70} y={30} s={10} c={C.rust} w={700}>330°</T>
    <g transform="translate(300 20)">
      <defs><linearGradient id="umSv" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#000"/><stop offset="1" stopColor="#fff"/></linearGradient>
        <linearGradient id="umSs" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff" stopOpacity="0"/><stop offset="1" stopColor="#d9461f" stopOpacity=".9"/></linearGradient></defs>
      <rect x="40" y="0" width="260" height="190" fill="url(#umSv)"/><rect x="40" y="0" width="260" height="190" fill="url(#umSs)" style={{mixBlendMode:"multiply"}}/>
      <rect x="40" y="0" width={260*.28} height={190*.28} fill="none" stroke={C.efflo} strokeWidth="2.4"/>
      <T x={46} y={16} s={10} c={C.efflo} w={700}>eflorescência</T>
      <rect x={40+260*.22} y={0} width={260*.78} height={190*.84} fill="none" stroke={C.rust} strokeWidth="2" strokeDasharray="5 3"/>
      <T x={300-6} y={150} a="end" s={10} c="#fff" w={700}>corrosão (S&gt;0,22 · V&gt;0,16)</T>
      <T x={170} y={210} a="middle" s={10.5}>saturação S →</T><T x={30} y={95} a="end" s={10.5}>V</T>
      <T x={40} y={204} s={9} c={C.muted}>0</T><T x={300} y={204} a="end" s={9} c={C.muted}>1</T>
    </g>
  </Fig>;
}

// 6 · Separação de famílias
export function FigFamilies({n}){
  return <Fig n={n} title="Separação de famílias" viewBox="0 0 640 210" caption="Regra de separação do CDM 2.10. Uma região de desplacamento com ≥ 60 % de pixels de corrosão é reclassificada como corrosão (armadura exposta também removida). Abaixo disso, as famílias são aninhadas: a armadura só existe dentro do desplacamento e a corrosão é retirada da máscara de fissuras.">
    <g><ellipse cx="110" cy="96" rx="90" ry="58" fill={C.spall} fillOpacity=".55" stroke={C.spall}/><ellipse cx="96" cy="92" rx="50" ry="34" fill={C.rust} fillOpacity=".85"/>
      <T x={110} y={176} a="middle" w={700}>corrosão ≥ 60 % da região</T><T x={110} y={192} a="middle" s={10} c={C.muted}>→ vira corrosão</T></g>
    <Arrow x1={210} y1={96} x2={250} y2={96}/>
    <g><ellipse cx="320" cy="96" rx="64" ry="44" fill={C.rust} fillOpacity=".85"/><T x={320} y={100} a="middle" c="#fff" w={700}>corrosão</T></g>
    <line x1="410" y1="20" x2="410" y2="190" stroke={C.line}/>
    <g transform="translate(420 0)"><ellipse cx="110" cy="96" rx="90" ry="58" fill={C.spall} fillOpacity=".55" stroke={C.spall}/>
      <rect x="40" y="86" width="140" height="7" rx="3" fill={C.rebar}/><rect x="40" y="104" width="140" height="7" rx="3" fill={C.rebar}/>
      <ellipse cx="160" cy="70" rx="14" ry="9" fill={C.rust} fillOpacity=".85"/>
      <T x={110} y={176} a="middle" w={700}>corrosão &lt; 60 %</T><T x={110} y={192} a="middle" s={10} c={C.muted}>aninhado: desplacamento ⊃ armadura</T></g>
  </Fig>;
}

// 7 · Consolidação de caixas
export function FigConsolidation({n}){
  return <Fig n={n} title="Consolidação de regiões" viewBox="0 0 640 190" caption="Consolidação das caixas delimitadoras de uma mesma classe: regiões menores que o limiar de relevância são descartadas (cinza) e caixas ≥ 80 % contidas em outra maior da mesma classe são absorvidas, somando a área.">
    <g><rect x="30" y="30" width="170" height="110" fill="none" stroke={C.spall} strokeWidth="2"/><rect x="60" y="56" width="70" height="50" fill="none" stroke={C.spall} strokeDasharray="4 3"/>
      <rect x="150" y="100" width="70" height="50" fill="none" stroke={C.spall} strokeDasharray="4 3"/><rect x="250" y="40" width="12" height="10" fill="none" stroke={C.muted}/>
      <T x={30} y={172} s={10.5}>antes: 4 caixas</T></g>
    <Arrow x1={290} y1={90} x2={340} y2={90}/>
    <g transform="translate(350 0)"><rect x="30" y="30" width="170" height="110" fill="none" stroke={C.spall} strokeWidth="2"/><rect x="150" y="100" width="70" height="50" fill="none" stroke={C.spall} strokeWidth="2"/>
      <T x={30} y={172} s={10.5}>depois: 2 caixas (contida absorvida; ínfima descartada)</T></g>
  </Fig>;
}

// 8 · Escala GDE
export function FigGde({n}){
  const bands=[[0,15,"Baixo","#5aa469"],[15,50,"Médio","#d8b13a"],[50,80,"Alto","#e58a2e"],[80,100,"Sofrível","#d4572a"],[100,140,"Crítico","#a32020"]];
  const sx=v=>20+v*4.3;
  const fis=[1,2,3,4],fp=[["fissuras",3,C.crack],["desplac.",4,C.spall],["armadura",5,C.rebar],["corrosão",5,C.rust],["eflor.",2,C.efflo]];
  const D=(fi,p)=>fi<=2?.8*fi*p:(12*fi-28)*p;
  return <Fig n={n} title="Escala do GDE e grau de dano" viewBox="0 0 640 280" caption="Acima: faixas de classificação do Grau de Dano do Elemento (GDE). Abaixo: grau de dano D por fator de intensidade Fi (1–4) e fator de ponderação Fp de cada patologia — o salto entre Fi = 2 e Fi = 3 decorre do ramo (12·Fi − 28)·Fp.">
    {bands.map(([a,b,l,c])=><g key={l}><rect x={sx(a)} y="16" width={sx(b)-sx(a)} height="26" fill={c}/><T x={(sx(a)+sx(b))/2} y={33} a="middle" s={10.5} c="#fff" w={700}>{l}</T><T x={sx(a)} y={56} a="middle" s={9.5} c={C.muted}>{a}</T></g>)}
    <T x={sx(140)} y={56} a="middle" s={9.5} c={C.muted}>GDE</T>
    <g transform="translate(40 80)">
      <line x1="0" y1="170" x2="560" y2="170" stroke={C.line}/>
      {[0,25,50,75,100].map(v=><g key={v}><line x1="0" x2="560" y1={170-v*1.6} y2={170-v*1.6} stroke={C.soft}/><T x={-6} y={174-v*1.6} a="end" s={9} c={C.muted}>{v}</T></g>)}
      {fis.map((fi,gi)=><g key={fi}>
        {fp.map(([name,p,c],k)=>{const d=D(fi,p);return <g key={name}><rect x={gi*140+14+k*22} y={170-d*1.6} width="18" height={d*1.6} rx="2" fill={c}/>{gi===3&&<T x={gi*140+23+k*22} y={164-d*1.6} a="middle" s={8.5}>{Math.round(d)}</T>}</g>})}
        <T x={gi*140+70} y={186} a="middle" s={10.5} w={700}>Fi = {fi}</T>
      </g>)}
      {fp.map(([name,p,c],k)=><g key={name} transform={`translate(${k*104} -12)`}><rect width="10" height="10" rx="2" fill={c}/><T x={14} y={9} s={9.5}>{name} (Fp {p})</T></g>)}
    </g>
  </Fig>;
}

// 9 · Registro temporal
export function FigTemporal({n}){
  return <Fig n={n} title="Comparação temporal" viewBox="0 0 640 220" caption="A imagem de referência t0 é alinhada à atual t1 por translação (dx, dy) que maximiza a semelhança dos mapas de bordas dentro da janela de busca ±s. Depois do alinhamento, pixels presentes só em t1 são crescimento (verde) e só em t0 são redução (roxo).">
    <rect x="20" y="20" width="170" height="150" fill="#fff" stroke={C.line}/><T x={105} y={190} a="middle" w={700}>t0 · referência</T>
    <path d="M40 140 C80 110 110 120 150 70" stroke={C.crack} strokeWidth="3" fill="none"/>
    <rect x="230" y="20" width="170" height="150" fill="#fff" stroke={C.line}/><T x={315} y={190} a="middle" w={700}>t1 · atual</T>
    <path d="M262 150 C302 120 332 130 372 80 L388 50" stroke={C.crack} strokeWidth="3" fill="none"/>
    <rect x="248" y="38" width="134" height="114" fill="none" stroke={C.teal} strokeDasharray="4 3"/><T x={252} y={34} s={9.5} c={C.teal}>janela ±s</T>
    <Arrow x1={40} y1={150} x2={58} y2={160} c={C.teal}/><T x={60} y={166} s={9.5} c={C.teal}>(dx, dy)</T>
    <rect x="440" y="20" width="170" height="150" fill="#fff" stroke={C.line}/><T x={525} y={190} a="middle" w={700}>diferença alinhada</T>
    <path d="M462 150 C502 120 532 130 572 80" stroke={C.ink} strokeWidth="3" strokeOpacity=".35" fill="none"/>
    <path d="M572 80 L588 50" stroke={C.growth} strokeWidth="4" fill="none"/><T x={540} y={46} a="end" s={10} c={C.growth} w={700}>crescimento</T>
    <path d="M470 160 L462 150" stroke={C.reduction} strokeWidth="4" fill="none"/><T x={480} y={164} s={10} c={C.reduction} w={700}>redução</T>
    <T x={20} y={212} s={9.5} c={C.muted}>s = min(96, max(6, 12 % do menor lado))</T>
  </Fig>;
}

// 10 · Réguas e calibração
export function FigCalibration({n}){
  return <Fig n={n} title="Calibração de escala" viewBox="0 0 640 170" caption="Calibração por objeto de referência: um comprimento conhecido (por exemplo, uma trena de 100 mm) medido como 412 px na imagem fornece 0,2427 mm/px. As réguas, larguras e áreas passam então a ser exibidas em milímetros.">
    <rect x="20" y="20" width="600" height="18" fill="#eef3f5"/>
    {Array.from({length:61},(_,i)=><line key={i} x1={20+i*10} y1={i%10===0?20:i%5===0?28:32} x2={20+i*10} y2="38" stroke={C.muted}/>)}
    {Array.from({length:7},(_,i)=><T key={i} x={22+i*100} y={52} s={9}>{i*24}</T>)}<T x={620} y={66} a="end" s={9} c={C.muted}>mm</T>
    <rect x="80" y="80" width="412" height="20" rx="3" fill="#ffd34d" stroke="#b28b00"/>
    {Array.from({length:11},(_,i)=><line key={i} x1={80+i*41.2} y1="80" x2={80+i*41.2} y2="90" stroke="#5e4a00"/>)}
    <line x1="80" y1="116" x2="492" y2="116" stroke={C.ink}/><line x1="80" y1="110" x2="80" y2="122" stroke={C.ink}/><line x1="492" y1="110" x2="492" y2="122" stroke={C.ink}/>
    <T x={286} y={134} a="middle" w={700}>412 px ≙ 100 mm → 0,2427 mm/px</T>
  </Fig>;
}

// 11 · Bland–Altman (esquemático)
export function FigBlandAltman({n}){
  const pts=[[40,.2],[70,-.3],[95,.5],[120,.1],[150,-.6],[180,.35],[210,-.1],[240,.6],[270,-.4],[300,.15],[330,-.2],[360,.45],[390,-.5],[420,.05],[450,.3],[480,-.15],[510,.25]];
  const sy=v=>100-v*60;
  return <Fig n={n} title="Bland–Altman" viewBox="0 0 640 200" caption="Diagrama de Bland–Altman usado no painel de Paridade: para cada medida, a diferença JS − Python contra a média das duas. A linha central é o viés médio e as tracejadas, os limites de concordância (média ± 1,96 DP).">
    <line x1="30" y1="10" x2="30" y2="180" stroke={C.line}/><line x1="30" y1="180" x2="560" y2="180" stroke={C.line}/>
    <line x1="30" y1={sy(.04)} x2="560" y2={sy(.04)} stroke={C.teal} strokeWidth="1.6"/><T x={566} y={sy(.04)+4} s={10} c={C.teal}>viés</T>
    <line x1="30" y1={sy(.74)} x2="560" y2={sy(.74)} stroke={C.crack} strokeDasharray="5 4"/><T x={566} y={sy(.74)+4} s={10} c={C.crack}>+1,96 DP</T>
    <line x1="30" y1={sy(-.66)} x2="560" y2={sy(-.66)} stroke={C.crack} strokeDasharray="5 4"/><T x={566} y={sy(-.66)+4} s={10} c={C.crack}>−1,96 DP</T>
    {pts.map(([x,v])=><circle key={x} cx={x+20} cy={sy(v)} r="4" fill="#2a78d6" stroke="#fff" strokeWidth="1.5"/>)}
    <T x={300} y={196} a="middle" s={10}>média (JS + Py)/2 →</T><T x={24} y={16} a="end" s={10}>Δ</T>
  </Fig>;
}

// 12 · Kernels 3×3
export function Kernel({title,m}){
  return <table className="umKernel" aria-label={title}><caption>{title}</caption><tbody>{m.map((r,i)=><tr key={i}>{r.map((v,j)=><td key={j} className={v>0?"pos":v<0?"neg":""}>{v}</td>)}</tr>)}</tbody></table>;
}
