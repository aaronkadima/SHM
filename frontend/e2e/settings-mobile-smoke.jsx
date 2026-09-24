import React,{useState,useEffect} from "react";
import {createRoot} from "react-dom/client";
import AnalysisSettings from "../src/AnalysisSettings.jsx";
import "../src/styles.css";

const engines=[
  {
    id:"cdm_1",name:"CDM-1",family:"Concrete Damage Morphology",task:"classical",
    description:"CDM 2.8.5: fissuras, desplacamento, armadura exposta, corrosão e eflorescência em camadas independentes; execução no navegador.",
    browser_ready:true,license:"SHM project"
  },
  ...Array.from({length:33},(_,i)=>({
    id:"engine_"+(i+1),
    name:["OpenCV Crack Baseline","GlassEye Infrastructure Defect Detector","SegFormer-B0 Crack Segmentation","U-Net Concrete Crack","YOLO Crack Detector","YOLOv8 Corrosion Segmentation"][i%6]+" "+(i+1),
    family:i%2?"Ultralytics / Hugging Face":"PyTorch / Hugging Face",
    task:i%3===0?"detection":"semantic_segmentation",
    description:"Motor público para validação responsiva do catálogo.",
    browser_ready:false,
    source_url:"https://github.com/"
  }))
];

function App(){
  const [selected,setSelected]=useState(["cdm_1"]);
  const [cdmOptions,setCdmOptions]=useState({
    cdm_threshold:17,cdm_kernel_size:21,cdm_min_area:20,cdm_min_aspect_ratio:2,
    cdm_mm_per_px:0,cdm_element_family:"barreiras_guarda_corpo_pista",cdm_alignment_method:"translation_auto"
  });
  const [inspectionMeta,setInspectionMeta]=useState({oae_id:"",element_id:"",source_id:"",inspection_label:""});
  const toggle=id=>setSelected(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id]);
  const updateInspectionMeta=(key,value)=>setInspectionMeta(v=>({...v,[key]:value}));
  return <div className="appShell editorShell settingsShell">
    <main className="appMain">
      <AnalysisSettings
        appInfo={{channel:"development",catalogVersion:"smoke",buildSha:"mobile"}}
        engines={engines}
        selected={selected}
        toggle={toggle}
        onBack={()=>{}}
        individualDraft="" setIndividualDraft={()=>{}}
        comparatorDraft="" setComparatorDraft={()=>{}}
        saveIndividual={()=>{}} saveComparator={()=>{}}
        testIndividual={()=>{}} testComparator={()=>{}}
        individualOnline={null} comparatorOnline={null}
        inspectionMeta={inspectionMeta} updateInspectionMeta={updateInspectionMeta}
        cdmOptions={cdmOptions} setCdmOptions={setCdmOptions}
        error=""
      />
    </main>
  </div>;
}

createRoot(document.getElementById("root")).render(<App/>);

function check(){
  const result=document.getElementById("settings-smoke-result");
  document.querySelectorAll("details.analysisSettingsCard").forEach(detail=>{detail.open=true});
  const content=document.querySelector(".settingsContent");
  const motors=document.querySelector(".settingsEngines");
  const motorsCard=document.querySelector(".settingsMotorsCard");
  const footer=document.querySelector(".settingsBottom");
  const top=document.querySelector(".settingsTop");
  const ownedCard=document.querySelector(".settingsEngineCardOwned");
  const motorCards=[...motors?.querySelectorAll(".settingsEngineCard")||[]];
  const firstOther=motorCards[0];
  if(!content||!motors||!motorsCard||!footer||!top||!firstOther)return false;

  const html=document.documentElement,body=document.body;
  const viewportH=window.innerHeight,viewportW=window.innerWidth;
  const visualBottom=(window.visualViewport?.height||viewportH)+(window.visualViewport?.offsetTop||0);
  const motorsRect=motors.getBoundingClientRect();
  const firstRect=firstOther.getBoundingClientRect();
  const footerRect=footer.getBoundingClientRect();
  const topRect=top.getBoundingClientRect();

  const documentNoScroll=html.scrollHeight<=viewportH+2&&body.scrollHeight<=viewportH+2;
  const pageScrollEnabled=getComputedStyle(content).overflowY==="auto"&&content.scrollHeight>content.clientHeight+10;
  const motorsScrollEnabled=getComputedStyle(motors).overflowY==="auto"&&motors.scrollHeight>motors.clientHeight+10;
  const motorsVisible=motorsRect.height>=175&&firstRect.height>=55&&firstRect.bottom>motorsRect.top&&firstRect.top<motorsRect.bottom;
  const cardRects=motorCards.slice(0,6).map(card=>card.getBoundingClientRect());
  const cardsSeparated=cardRects.length>=4&&cardRects.every((rect,index)=>index===0||rect.top>=cardRects[index-1].bottom-1)&&cardRects.every(rect=>rect.height>=55);
  const barsVisible=topRect.top>=-1&&topRect.bottom<=visualBottom+1&&footerRect.top>=0&&footerRect.bottom<=visualBottom+1;
  const selectedCountOk=document.querySelector(".settingsStatusEngines")?.textContent?.trim()==="Motores selecionados: 1"&&!document.querySelector(".settingsStatusMeta");
  const ownedActions=[...ownedCard?.querySelectorAll(".settingsEngineCodeActions button")||[]].map(button=>button.textContent.trim());
  const cardActionsOk=ownedActions.some(text=>text.includes("Informações"))&&ownedActions.some(text=>text.includes("Atualização"));
  const noHorizontalOverflow=html.scrollWidth<=viewportW+2&&body.scrollWidth<=viewportW+2;
  const candidates=[html,body,content,motorsCard,motors];
  const verticalScrollers=candidates.filter(el=>el.scrollHeight>el.clientHeight+3&&["auto","scroll"].includes(getComputedStyle(el).overflowY));
  const intendedScrollers=verticalScrollers.length===2&&verticalScrollers.includes(content)&&verticalScrollers.includes(motors);

  const checks={documentNoScroll,pageScrollEnabled,motorsScrollEnabled,motorsVisible,cardsSeparated,barsVisible,selectedCountOk,cardActionsOk,noHorizontalOverflow,intendedScrollers};
  const failed=Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name);
  result.textContent=failed.length
    ?"SETTINGS_SMOKE_FAIL "+failed.join(",")+" motorsHeight="+Math.round(motorsRect.height)+" viewport="+viewportW+"x"+viewportH+" html="+html.scrollHeight+"/"+html.clientHeight+" body="+body.scrollHeight+"/"+body.clientHeight+" footer="+Math.round(footerRect.top)+"-"+Math.round(footerRect.bottom)+" visualBottom="+Math.round(visualBottom)
    :"SETTINGS_SMOKE_PASS viewport="+viewportW+"x"+viewportH+" motorsHeight="+Math.round(motorsRect.height)+" cards=separated actions=info+update selected=count scroll=page+motors footer=visual-viewport";
  return true;
}

let attempts=0;
const timer=setInterval(()=>{
  attempts++;
  if(check()||attempts>40)clearInterval(timer);
},100);
