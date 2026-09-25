import React,{useState,useEffect} from "react";
import {createRoot} from "react-dom/client";
import AnalysisSettings from "../src/AnalysisSettings.jsx";
import {engineCodePackage} from "../src/engineCodeCatalog.js";
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

const originalFetch=globalThis.fetch?.bind(globalThis);
const cdmRepositorySource=engineCodePackage(engines[0])?.repositorySource||"";
globalThis.fetch=async(input,init={})=>{
  const url=String(input?.url||input||"");
  if(url.includes("raw.githubusercontent.com/aaronkadima/SHM/")){
    throw new TypeError("Failed to fetch");
  }
  if(url.includes("api.github.com/repos/aaronkadima/SHM/contents/")){
    return new Response(cdmRepositorySource,{status:200,headers:{"Content-Type":"text/plain;charset=utf-8"}});
  }
  if(originalFetch)return originalFetch(input,init);
  throw new TypeError("Unexpected fetch in settings smoke: "+url);
};

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
  const envSwitch=document.querySelector(".settingsEnvSwitch");
  const envSwitchRect=envSwitch?.getBoundingClientRect();

  const documentNoScroll=html.scrollHeight<=viewportH+2&&body.scrollHeight<=viewportH+2;
  const pageScrollEnabled=getComputedStyle(content).overflowY==="auto"&&content.scrollHeight>content.clientHeight+10;
  const motorsScrollEnabled=getComputedStyle(motors).overflowY==="auto"&&motors.scrollHeight>motors.clientHeight+10;
  const shortViewport=viewportH<=500;
  const minMotorsHeight=shortViewport?96:175;
  const motorsVisible=motorsRect.height>=minMotorsHeight&&firstRect.height>=55&&firstRect.bottom>motorsRect.top&&firstRect.top<motorsRect.bottom;
  const cardRects=motorCards.slice(0,6).map(card=>card.getBoundingClientRect());
  const cardsSeparated=cardRects.length>=4&&cardRects.every((rect,index)=>index===0||rect.top>=cardRects[index-1].bottom-1)&&cardRects.every(rect=>rect.height>=55);
  const barsVisible=topRect.top>=-1&&topRect.bottom<=visualBottom+1&&footerRect.top>=0&&footerRect.bottom<=visualBottom+1;
  const selectedCountOk=document.querySelector(".settingsStatusEngines")?.textContent?.trim()==="Motores selecionados: 1"&&!document.querySelector(".settingsStatusMeta");
  const ownedActionButtons=[...ownedCard?.querySelectorAll(".settingsEngineCodeActions button")||[]];
  const ownedActions=ownedActionButtons.map(button=>button.textContent.trim());
  const updateButton=ownedActionButtons.find(button=>button.textContent.includes("Atualização"));
  if(!updateCheckStarted&&updateButton){
    updateCheckStarted=true;
    updateButton.click();
    return false;
  }
  const updateState=ownedCard?.querySelector(".settingsSyncState");
  if(updateCheckStarted&&updateState?.classList.contains("checking"))return false;
  const ownedRect=ownedCard?.getBoundingClientRect();
  const cardActionsOk=ownedActions.some(text=>text.includes("Informações"))&&ownedActions.some(text=>text.includes("Atualização"));
  const updateFallbackOk=updateCheckStarted&&updateState?.classList.contains("current")&&updateState.textContent.includes("Atualizado")&&!updateState.textContent.includes("Failed to fetch");
  const cardActionsFit=!!ownedRect&&ownedActionButtons.length>=4&&ownedActionButtons.every(button=>{const r=button.getBoundingClientRect();return r.left>=ownedRect.left-1&&r.right<=ownedRect.right+1&&r.top>=ownedRect.top-1&&r.bottom<=ownedRect.bottom+1});
  const environmentSwitchOk=!!envSwitch&&envSwitch.textContent.trim()==="Abrir PROD"&&envSwitch.getAttribute("href")?.includes("#/settings")&&!envSwitch.getAttribute("href")?.includes("/dev/")&&!!envSwitchRect&&envSwitchRect.left>=topRect.left-1&&envSwitchRect.right<=topRect.right+1;
  const noHorizontalOverflow=html.scrollWidth<=viewportW+2&&body.scrollWidth<=viewportW+2;
  const candidates=[html,body,content,motorsCard,motors];
  const verticalScrollers=candidates.filter(el=>el.scrollHeight>el.clientHeight+3&&["auto","scroll"].includes(getComputedStyle(el).overflowY));
  const intendedScrollers=verticalScrollers.length===2&&verticalScrollers.includes(content)&&verticalScrollers.includes(motors);

  const checks={documentNoScroll,pageScrollEnabled,motorsScrollEnabled,motorsVisible,cardsSeparated,barsVisible,environmentSwitchOk,selectedCountOk,cardActionsOk,updateFallbackOk,cardActionsFit,noHorizontalOverflow,intendedScrollers};
  const failed=Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name);
  result.textContent=failed.length
    ?"SETTINGS_SMOKE_FAIL "+failed.join(",")+" motorsHeight="+Math.round(motorsRect.height)+" viewport="+viewportW+"x"+viewportH+" html="+html.scrollHeight+"/"+html.clientHeight+" body="+body.scrollHeight+"/"+body.clientHeight+" footer="+Math.round(footerRect.top)+"-"+Math.round(footerRect.bottom)+" visualBottom="+Math.round(visualBottom)+" minMotors="+minMotorsHeight
    :"SETTINGS_SMOKE_PASS viewport="+viewportW+"x"+viewportH+" motorsHeight="+Math.round(motorsRect.height)+" cards=separated env-switch=fit actions=info+update+fallback+fit selected=count scroll=page+motors footer=visual-viewport";
  return true;
}

let attempts=0,updateCheckStarted=false;
const timer=setInterval(()=>{
  attempts++;
  if(check()||attempts>40)clearInterval(timer);
},100);
