import React from "react";

// Mini-conversor TeX → MathML (subconjunto) para as equações do manual.
// Suporta: \frac{a}{b}, \sqrt{a}, \text{..}, \op{..} (nome reto), grupos {..},
// índices _x ^x, letras gregas/símbolos comuns e \left/\right (ignorados).
const SYM={
  alpha:"α",beta:"β",gamma:"γ",delta:"δ",Delta:"Δ",epsilon:"ε",varepsilon:"ε",theta:"θ",lambda:"λ",mu:"μ",pi:"π",
  rho:"ρ",sigma:"σ",Sigma:"Σ",phi:"φ",varphi:"φ",psi:"ψ",omega:"ω",Omega:"Ω",tau:"τ",kappa:"κ",nabla:"∇",infty:"∞",
  partial:"∂",ell:"ℓ"
};
const OPS={
  le:"≤",ge:"≥",leq:"≤",geq:"≥",ne:"≠",neq:"≠",approx:"≈",cdot:"·",times:"×",pm:"±",to:"→",gets:"←",in:"∈",notin:"∉",
  cup:"∪",cap:"∩",setminus:"∖",ominus:"⊖",oplus:"⊕",circ:"∘",bullet:"•",sum:"∑",prod:"∏",land:"∧",lor:"∨",lnot:"¬",
  mid:"|",lvert:"|",rvert:"|",Vert:"‖",lfloor:"⌊",rfloor:"⌋",lceil:"⌈",rceil:"⌉",langle:"⟨",rangle:"⟩",forall:"∀",exists:"∃",
  Rightarrow:"⇒",iff:"⇔",quad:" ",qquad:" ",",":" ",";":" ",dots:"…",ldots:"…",cdots:"⋯",subseteq:"⊆",ast:"∗",star:"⋆",
  oslash:"⊘"
};
const NAMES=new Set(["min","max","log","ln","exp","sin","cos","arg","argmin","argmax","var","mean","sgn","clip","med","card","det"]);

function parse(src){
  let i=0,key=0;
  const k=()=>"m"+(key++);
  const peek=()=>src[i];
  function group(){
    // lê {..} ou um átomo único
    while(src[i]===" ")i++;
    if(src[i]==="{"){i++;const items=seq("}");i++;return items.length===1?items[0]:<mrow key={k()}>{items}</mrow>}
    return atom();
  }
  function rawGroup(){
    while(src[i]===" ")i++;
    if(src[i]!=="{")return src[i++]||"";
    let depth=0,start=++i;
    for(;i<src.length;i++){if(src[i]==="{")depth++;else if(src[i]==="}"){if(!depth)break;depth--}}
    const out=src.slice(start,i);i++;return out;
  }
  function atom(){
    const c=peek();
    if(c==null)return null;
    if(c==="\\"){
      i++;
      let name="";
      if(/[a-zA-Z]/.test(src[i])){while(/[a-zA-Z]/.test(src[i]||""))name+=src[i++]}
      else name=src[i++];
      if(name==="frac"){const a=group(),b=group();return <mfrac key={k()}>{a}{b}</mfrac>}
      if(name==="sqrt"){const a=group();return <msqrt key={k()}>{a}</msqrt>}
      if(name==="text")return <mtext key={k()}>{rawGroup().replace(/^ | $/g,"\u00a0")}</mtext>;
      if(name==="bar"||name==="hat"||name==="tilde"){const a=group();return <mover key={k()} accent="true">{a}<mo>{{bar:"¯",hat:"^",tilde:"~"}[name]}</mo></mover>}
      if(name==="|")return <mo key={k()} stretchy="false">‖</mo>;
      if(name==="mathbf")return <mi key={k()} mathvariant="bold">{rawGroup()}</mi>;
      if(name==="op")return <mi key={k()} mathvariant="normal">{rawGroup()}</mi>;
      if(name==="left"||name==="right"){while(src[i]===" ")i++;let ch=src[i++];if(ch==="\\"){ch=src[i++];if(ch==="|")ch="‖"}if(ch===".")return <mrow key={k()}/>;return <mo key={k()} stretchy="true">{ch}</mo>}
      if(name==="quad"||name==="qquad")return <mspace key={k()} width={name==="quad"?"1em":"2em"}/>;
      if(name==="{"||name==="}")return <mo key={k()} stretchy="false">{name}</mo>;
      if(name in SYM)return <mi key={k()}>{SYM[name]}</mi>;
      if(name in OPS&&"|‖⌊⌋⌈⌉⟨⟩".includes(OPS[name]))return <mo key={k()} stretchy="false">{OPS[name]}</mo>;
      if(name in OPS)return OPS[name]===" "?<mspace key={k()} width="0.3em"/>:<mo key={k()}>{OPS[name]}</mo>;
      if(NAMES.has(name))return <mi key={k()} mathvariant="normal">{name}</mi>;
      return <mi key={k()}>{name}</mi>;
    }
    if(/[0-9.]/.test(c)){let s="";while(/[0-9.]/.test(src[i]||""))s+=src[i++];return <mn key={k()}>{s}</mn>}
    if(/[a-zA-Z]/.test(c)){
      let s="";while(/[a-zA-Z]/.test(src[i]||""))s+=src[i++];
      if(s.length===1)return <mi key={k()}>{s}</mi>;
      return <mi key={k()} mathvariant="normal">{s}</mi>;
    }
    if(/[À-ÿ]/.test(c)){let s="";while(/[A-Za-zÀ-ÿ]/.test(src[i]||""))s+=src[i++];return <mi key={k()} mathvariant="normal">{s}</mi>}
    i++;
    if(c==="{"){i--;return group()}
    if(c==="'")return <mo key={k()}>′</mo>;
    if(c==="-")return <mo key={k()}>−</mo>;
    if(c==="*")return <mo key={k()}>·</mo>;
    if("()[]|".includes(c))return <mo key={k()} stretchy="false">{c}</mo>;
    return <mo key={k()}>{c}</mo>;
  }
  function seq(end){
    const items=[];
    while(i<src.length&&src[i]!==end){
      if(src[i]===" "){i++;continue}
      let base=atom();if(base==null)break;
      let sub=null,sup=null;
      for(;;){
        while(src[i]===" ")i++;
        if(src[i]==="_"){i++;sub=group();continue}
        if(src[i]==="^"){i++;sup=group();continue}
        break;
      }
      if(sub&&sup)base=<msubsup key={k()}>{base}{sub}{sup}</msubsup>;
      else if(sub)base=<msub key={k()}>{base}{sub}</msub>;
      else if(sup)base=<msup key={k()}>{base}{sup}</msup>;
      items.push(base);
    }
    return items;
  }
  return seq(null);
}

// Equação em bloco, com número opcional e legenda.
export function Eq({children,n,label}){
  const tex=String(children);
  return <figure className="umEq">
    <math display="block" aria-label={label||tex}><mrow>{parse(tex)}</mrow></math>
    {n!=null&&<span className="umEqN">({n})</span>}
  </figure>;
}
// Expressão em linha.
export function M({children}){
  return <math className="umInline"><mrow>{parse(String(children))}</mrow></math>;
}
