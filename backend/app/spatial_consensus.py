from __future__ import annotations
import base64, io
from collections import defaultdict
from PIL import Image, ImageDraw
from .taxonomy import canonicalize, display_name

PALETTE=[
    (239,68,68),(245,158,11),(168,85,247),(14,165,233),
    (34,197,94),(236,72,153),(99,102,241),(120,113,108),(20,184,166)
]

def _iou(a,b):
    x1=max(a[0],b[0]); y1=max(a[1],b[1]); x2=min(a[2],b[2]); y2=min(a[3],b[3])
    inter=max(0.0,x2-x1)*max(0.0,y2-y1)
    aa=max(0.0,a[2]-a[0])*max(0.0,a[3]-a[1])
    bb=max(0.0,b[2]-b[0])*max(0.0,b[3]-b[1])
    den=aa+bb-inter
    return inter/den if den>0 else 0.0

def _avg_box(items):
    n=len(items)
    return [round(sum(float(x["box"][i]) for x in items)/n,2) for i in range(4)]

def build_spatial_consensus(results,min_iou=0.25):
    successful=[r for r in results if r.status=="ok"]
    total=len(successful)
    items=[]
    for r in successful:
        for d in r.detections:
            if not d.box or len(d.box)!=4:
                continue
            label=d.canonical_label or canonicalize(d.label)
            items.append({
                "engine":r.engine_id,"label":label,"box":[float(v) for v in d.box],
                "score":float(d.score) if d.score is not None else None
            })
    items.sort(key=lambda x:x["score"] if x["score"] is not None else -1,reverse=True)
    clusters=[]
    for item in items:
        best=None; best_iou=0.0
        for c in clusters:
            if c["canonical_label"]!=item["label"]:
                continue
            score=_iou(item["box"],_avg_box(c["_items"]))
            if score>=min_iou and score>best_iou:
                best=c;best_iou=score
        if best is None:
            clusters.append({"canonical_label":item["label"],"_items":[item]})
        else:
            best["_items"].append(item)
    out=[]
    for idx,c in enumerate(clusters,1):
        vals=c["_items"]; engines=sorted(set(x["engine"] for x in vals))
        scored=[x["score"] for x in vals if x["score"] is not None]
        mean_score=sum(scored)/len(scored) if scored else None
        out.append({
            "id":idx,"canonical_label":c["canonical_label"],"label":display_name(c["canonical_label"]),
            "box":_avg_box(vals),"engines":engines,"engine_count":len(engines),
            "successful_engine_count":total,
            "agreement_ratio":round(len(engines)/total,4) if total else 0.0,
            "detection_count":len(vals),"mean_score":round(mean_score,4) if mean_score is not None else None,
            "iou_threshold":min_iou
        })
    out.sort(key=lambda x:(-x["engine_count"],-(x["mean_score"] if x["mean_score"] is not None else -1),x["canonical_label"]))
    return out

def render_spatial_consensus(image,clusters):
    canvas=image.convert("RGB").copy(); draw=ImageDraw.Draw(canvas)
    label_order={}
    for c in clusters:
        if c["canonical_label"] not in label_order:
            label_order[c["canonical_label"]]=len(label_order)
        color=PALETTE[label_order[c["canonical_label"]]%len(PALETTE)]
        box=tuple(c["box"])
        width=2+min(4,max(0,c["engine_count"]-1))
        draw.rectangle(box,outline=color,width=width)
        txt=f'{c["label"]} · {c["engine_count"]}/{c["successful_engine_count"]}'
        x=max(0,int(box[0])); y=max(0,int(box[1])-14)
        draw.rectangle((x,y,x+max(70,len(txt)*6),y+14),fill=(0,0,0))
        draw.text((x+2,y+1),txt,fill=color)
    buff=io.BytesIO();canvas.save(buff,format="PNG")
    return base64.b64encode(buff.getvalue()).decode("ascii")
