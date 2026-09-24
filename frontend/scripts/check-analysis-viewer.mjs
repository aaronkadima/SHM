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
check(workspace.includes('loadViewerPreferences'),"viewer must load safe visual preferences");
check(workspace.includes('saveViewerPreferences'),"viewer must persist safe visual preferences");
check(workspace.includes('const basePreview=localPreview||prev'),"viewer must prefer a fresh File-derived preview over parent preview URLs");
check(workspace.includes('new FileReader()'),"viewer must read the imported image independently");
check(workspace.includes('reader.readAsDataURL(file)'),"viewer must use a persistent data URL preview");
check(workspace.includes('setComparison(preferredComparison)'),"new files must restore the persisted non-temporal comparison mode");
check(workspace.includes('function fitView(){setZoom(1)}'),"viewer must expose fit-to-screen behavior");
check(workspace.includes('function changeComparison(mode){setComparison(mode);if(mode!=="temporal")setPreferredComparison(mode);fitView()}'),"comparison mode changes must refit while keeping temporal mode non-persistent");
check(workspace.includes('function setPathologyGroupVisible(next)'),"viewer must support group pathology visibility");
check(workspace.includes('function isolatePathologyLayer(id)'),"viewer must support single-pathology isolation");
check(workspace.includes('function movePathologyLayer(id,delta)'),"viewer must support pathology z-order changes");
check(workspace.includes('function setSelectedPathologyOpacity(value)'),"viewer must support selected-layer opacity");
check(workspace.includes('opacity:opacity*Number(pathologyOpacity[layer.id]??1)'),"pathology layer opacity must multiply the global opacity");
check(workspace.includes('className="layerInspector"'),"viewer must expose a compact selected-layer inspector");
check(workspace.includes('Opacidade da camada'),"selected-layer inspector must expose layer opacity");
check(workspace.includes('function toggleSelectedPathologyLock()'),"viewer must support persistent pathology locks");
check(workspace.includes('if(pathologyLocked.has(id))return'),"locked layers must reject direct z-order changes");
check(workspace.includes('disabled={selectedPathologyLocked}'),"locked layers must disable opacity editing");
check(workspace.includes('Desbloquear'),"layer inspector must expose lock state");
check(workspace.includes('function resetViewerPreferences()'),"viewer must expose a safe visualization reset");
check(workspace.includes('Restaurar visualização'),"viewer must surface the visualization reset action");
check(workspace.includes('[...orderedPathologyLayers].reverse()'),"top layer in the panel must render on top of the overlay stack");
check(workspace.includes('>Original</button>'),"viewer must expose a dedicated Original comparison mode");
check(workspace.includes('const safeViewport={width:Math.max(480'),"viewer must protect against zero-size viewport collapse");
check(workspace.includes('Math.max(160,safeImage.width*fit*panes)'),"viewer must keep a visible minimum display width");
check(workspace.includes('Imagem carregada'),"viewer must expose decoded image dimensions");
check(workspace.includes('comparison==="original"&&renderBasePane(basePreview,"Imagem original da inspeção","original",true,false)'),"original mode must render the base image without overlays");
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
