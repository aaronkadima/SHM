import re
from collections import defaultdict

ALIASES={
    "crack":"crack","cracks":"crack","structural crack":"crack","structural_crack":"crack",
    "microcrack":"crack","micro crack":"crack","microfissure":"crack","fissure":"crack","fissura":"crack",
    "net crack":"crack","net_crack":"crack","crack candidate":"crack","crack_candidate":"crack",
    "rust":"corrosion","rust corrosion":"corrosion","corrosion":"corrosion","rebar corrosion":"corrosion",
    "rebar_corrosion":"corrosion","steel corrosion":"corrosion",
    "spalling":"spalling","concrete spalling":"spalling","spall":"spalling",
    "exposed rebar":"exposed_rebar","exposed reinforcement bar":"exposed_rebar","exposed reinforcement":"exposed_rebar",
    "rebar exposure":"exposed_rebar","exposed_rebar":"exposed_rebar",
    "efflorescence":"efflorescence","precipitation":"efflorescence",
    "water stain":"moisture","water leakage":"moisture","water leak":"moisture","waterleak":"moisture",
    "moisture":"moisture","damp":"moisture",
    "delamination":"delamination",
    "severe distress":"general_damage","severe_distress":"general_damage","concrete damage":"general_damage",
    "damage":"general_damage","defect":"general_damage","other":"general_damage",
    "crushing":"crushing","concrete crushing":"crushing",
}
DISPLAY={
    "crack":"Fissura","corrosion":"Corrosão","spalling":"Desplacamento",
    "exposed_rebar":"Armadura exposta","efflorescence":"Eflorescência",
    "moisture":"Umidade/Infiltração","delamination":"Delaminação",
    "crushing":"Esmagamento","general_damage":"Dano geral",
}

def _clean(label):
    x=str(label or "").strip().lower().replace("-"," ").replace("_"," ")
    return re.sub(r"\s+"," ",x)

def canonicalize(label):
    raw=_clean(label)
    if raw in ALIASES:return ALIASES[raw]
    for key,value in ALIASES.items():
        if key in raw:return value
    return raw.replace(" ","_") or "unknown"

def display_name(canonical):
    return DISPLAY.get(canonical,canonical.replace("_"," ").title())

def apply_taxonomy(result):
    for d in result.detections:
        d.canonical_label=canonicalize(d.label)
    return result

def build_consensus(results):
    by=defaultdict(lambda:{"engines":set(),"detections":0,"scores":[]})
    successful=[r for r in results if r.status=="ok"]
    for r in successful:
        per_engine=set()
        for d in r.detections:
            c=d.canonical_label or canonicalize(d.label)
            by[c]["detections"]+=1
            if d.score is not None:by[c]["scores"].append(float(d.score))
            per_engine.add(c)
        for c in per_engine:by[c]["engines"].add(r.engine_id)
    out={}
    total=len(successful)
    for c,v in by.items():
        n=len(v["engines"])
        out[c]={
            "label":display_name(c),"engines":sorted(v["engines"]),"engine_count":n,
            "successful_engine_count":total,"agreement_ratio":round(n/total,4) if total else 0.0,
            "detections":v["detections"],
            "mean_score":round(sum(v["scores"])/len(v["scores"]),4) if v["scores"] else None,
        }
    return dict(sorted(out.items(),key=lambda kv:(-kv[1]["engine_count"],kv[0])))
