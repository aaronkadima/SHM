// IFC mínimo para o modo "gerar sem importar": projeto (mm), terreno e uma placa vertical que representa a
// superfície fotografada (largura × altura da foto em mm). A placa é o hospedeiro das IfcSurfaceFeature do
// sólido de níveis, gravadas depois por writeLevelSolid. Face frontal: y = 0, normal −Y, direita = +X, topo em z = H.
import{encodeStepString,ifcGuid}from"./ifcLevelSolidWriter.js";

const num=v=>{const s=(+(+v).toPrecision(12)).toString();return /[.eE]/.test(s)?s.replace("e","E"):s+"."};
export function referenceHostIfc({schema="IFC4X3",widthMm,heightMm,thicknessMm=50,name="Superfície de referência (foto)",description="",fileName="cdm4_forma_dano.ifc",date=new Date()}={}){
  const W=Math.max(1,+widthMm),H=Math.max(1,+heightMm),T=Math.max(1,+thicknessMm),is43=/X3/i.test(schema),sch=is43?"IFC4X3_ADD2":"IFC4";
  const hostGuid=ifcGuid(),stamp=new Date(date).toISOString().slice(0,19);
  const L=[
    "#1=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);","#2=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);","#3=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);",
    "#4=IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.);","#5=IFCUNITASSIGNMENT((#1,#2,#3,#4));",
    "#6=IFCCARTESIANPOINT((0.,0.,0.));","#7=IFCAXIS2PLACEMENT3D(#6,$,$);",
    "#8=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#7,$);",
    "#9=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#8,$,.MODEL_VIEW.,$);",
    `#10=IFCPROJECT(${encodeStepString(ifcGuid())},$,${encodeStepString("SHM Studio · CDM-4")},$,$,$,$,(#8),#5);`,
    "#11=IFCLOCALPLACEMENT($,#7);",
    `#12=IFCSITE(${encodeStepString(ifcGuid())},$,${encodeStepString("Local")},$,$,#11,$,$,.ELEMENT.,$,$,$,$,$);`,
    `#13=IFCRELAGGREGATES(${encodeStepString(ifcGuid())},$,$,$,#10,(#12));`,
    "#14=IFCLOCALPLACEMENT(#11,#7);",
    `#15=IFCCARTESIANPOINT((${num(W/2)},${num(T/2)}));`,"#16=IFCAXIS2PLACEMENT2D(#15,$);",
    `#17=IFCRECTANGLEPROFILEDEF(.AREA.,$,#16,${num(W)},${num(T)});`,"#18=IFCDIRECTION((0.,0.,1.));",
    `#19=IFCEXTRUDEDAREASOLID(#17,#7,#18,${num(H)});`,"#20=IFCSHAPEREPRESENTATION(#9,'Body','SweptSolid',(#19));",
    "#21=IFCPRODUCTDEFINITIONSHAPE($,$,(#20));",
    `#22=IFCBUILDINGELEMENTPROXY(${encodeStepString(hostGuid)},$,${encodeStepString(name)},${description?encodeStepString(description):"$"},$,#14,#21,$,.NOTDEFINED.);`,
    `#23=IFCRELCONTAINEDINSPATIALSTRUCTURE(${encodeStepString(ifcGuid())},$,$,$,(#22),#12);`,
    "#24=IFCCOLOURRGB($,0.78,0.8,0.8);","#25=IFCSURFACESTYLESHADING(#24,0.);",
    `#26=IFCSURFACESTYLE(${encodeStepString("Superfície de referência")},.BOTH.,(#25));`,"#27=IFCSTYLEDITEM(#19,(#26),$);",
  ];
  const text=["ISO-10303-21;","HEADER;","FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');",
    `FILE_NAME(${encodeStepString(fileName)},'${stamp}',(''),(''),'SHM Studio CDM-4','SHM Studio','');`,
    `FILE_SCHEMA(('${sch}'));`,"ENDSEC;","DATA;",...L,"ENDSEC;","END-ISO-10303-21;",""].join("\n");
  return{text,hostGuid,schema:sch,face:{origin:[0,0,H],ex:[1,0,0],n:[0,-1,0]},widthMm:W,heightMm:H,thicknessMm:T};
}
