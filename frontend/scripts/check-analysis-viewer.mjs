import fs from "node:fs";

const workspace=fs.readFileSync(new URL("../src/AnalysisWorkspace.jsx",import.meta.url),"utf8");
const styles=fs.readFileSync(new URL("../src/styles.css",import.meta.url),"utf8");
const failures=[];
const check=(ok,msg)=>{if(!ok)failures.push(msg)};

check(!workspace.includes("const image=pathologyLayers.length?null"),"CDM overlays must not suppress the original base image");
check(workspace.includes('className="editorOverlayStack"'),"viewer must use an explicit overlay stack");
check(workspace.includes('const useCombinedEngineOverlay=!!engineOverlay&&pathologyLayers.length===0'),"CDM combined overlay must be suppressed when individual pathology layers exist");
check(workspace.includes('overlay_semantics')||workspace.includes('overlaySemantics'),"viewer must distinguish overlay semantics");
check(workspace.includes('className="editorBaseImage"'),"viewer panes must include an original base image");
check(workspace.includes('const basePreview=localPreview||prev'),"viewer must prefer a fresh File-derived preview over parent preview URLs");
check(workspace.includes('new FileReader()'),"viewer must read the imported image independently");
check(workspace.includes('reader.readAsDataURL(file)'),"viewer must use a persistent data URL preview");
check(workspace.includes('setComparison("overlay")'),"new files must reset comparison mode to overlay");
check(workspace.includes('const safeViewport={width:Math.max(480'),"viewer must protect against zero-size viewport collapse");
check(workspace.includes('Math.max(160,safeImage.width*fit*panes)'),"viewer must keep a visible minimum display width");
check(workspace.includes('Imagem carregada'),"viewer must expose decoded image dimensions");
check(workspace.includes('comparison==="overlay"&&renderBasePane(basePreview,"Imagem original da inspeção","original + camadas",true,true)'),"overlay mode must render original + overlays in the same pane");
check(workspace.includes('comparison==="side"&&<>'),"side-by-side mode must have explicit two-pane composition");
check(workspace.includes('renderBasePane(basePreview,"Imagem original da inspeção","original",true,false)'),"side-by-side left pane must be the original image");
check(workspace.includes('renderBasePane(basePreview,"Imagem original com camadas de detecção","original + detecções",false,true)'),"side-by-side right pane must be original + overlays");
check(workspace.includes('renderBasePane(basePreview,"Imagem atual t1 com camadas de detecção","t1 atual + camadas",true,true)'),"temporal t1 pane must include original + overlays");
check(styles.includes(".editorOverlayStack{position:absolute;inset:0"),"overlay stack must be anchored to the full pane");
check(!styles.includes(".editorImagePane{position:relative}"),"global relative pane override must not collapse overlay mode");
check(styles.includes(".editorImage>.editorImagePane{position:absolute;inset:0;width:100%;height:100%}"),"overlay pane must fill the entire viewer");
check(styles.includes(".editorImage.editorSide>.editorImagePane{position:relative;inset:auto;width:50%;height:100%}"),"side-by-side panes must split the viewer without affecting overlay mode");
check(styles.includes(".editorBaseImage{position:absolute;inset:0"),"base image must share overlay coordinates");
check(styles.includes(".editorSide .compositePane{border-left:2px solid white}"),"side-by-side composite pane must remain visually separated");

if(failures.length){
  console.error("Analysis viewer composition failures:");
  failures.forEach(x=>console.error(" - "+x));
  process.exit(1);
}
console.log("Analysis viewer composition passed: original image remains under detection layers in overlay, side-by-side and temporal modes.");
