import React,{useEffect,useMemo,useRef,useState} from "react";
import {BookOpen,ChevronLeft,ChevronRight,Printer,Search,X} from "lucide-react";
import {Eq,M} from "./manualMath.jsx";
import {FigInterface,FigPipeline,FigBlackHat,FigSkeleton,FigHsv,FigFamilies,FigConsolidation,FigGde,FigTemporal,FigCalibration,FigBlandAltman,Kernel} from "./manualFigures.jsx";

// Manual do usuário do SHM Studio — capítulos paginados na horizontal,
// com equações (MathML) e ilustrações técnicas (SVG). Aberto em popup grande.

const Tbl=({head,rows,cls=""})=><div className="umTableWrap"><table className={"umTable "+cls}><thead><tr>{head.map((h,i)=><th key={i}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j}>{c}</td>)}</tr>)}</tbody></table></div>;
const Note=({kind="info",children})=><aside className={"umNote "+kind}>{children}</aside>;
const K=({children})=><kbd>{children}</kbd>;

function chapters(shortcuts){
  let fig=0;const f=()=>++fig;
  let eq=0;const e=()=>++eq;
  return [
  {id:"intro",title:"Visão geral",kw:"introdução fluxo objetivo motores",body:<>
    <p className="umLead">O <b>SHM Studio</b> é o ambiente de inspeção visual do SHM Vision Lab: importa fotografias (ou modelos 3D) de elementos de concreto, detecta manifestações patológicas, mede-as em pixels ou milímetros, classifica a condição do elemento e compara campanhas no tempo. Todo o processamento padrão roda <b>no próprio navegador</b> — nenhuma imagem sai do computador.</p>
    <FigPipeline n={f()}/>
    <h3>O que o programa entrega</h3>
    <ul>
      <li><b>Cinco camadas de dano</b>: fissuras, desplacamento (lascamento escuro), armadura exposta, corrosão (manchas de ferrugem) e eflorescência (depósitos brancos).</li>
      <li><b>Medidas</b> por achado: área, comprimento e largura média de fissuras, alongamento, caixa delimitadora, centroide.</li>
      <li><b>Classificação de condição</b>: grau de dano D por achado, GDE do elemento, estado de conservação (EC) e nota técnica (NT 1–5) no estilo DNIT.</li>
      <li><b>Comparação temporal</b> t0 → t1 com registro automático, IoU por classe e mapas de crescimento/redução.</li>
      <li><b>Paridade</b> JavaScript ⇄ Python do motor de referência, com métricas e gráficos.</li>
      <li><b>Exportação</b> em CSV, SVG, COCO JSON, DXF, BIM JSON, IFC e relatório HTML.</li>
    </ul>
    <h3>Motores disponíveis</h3>
    <Tbl head={["Motor","Tipo","Onde roda"]} rows={[
      ["CDM-1 (CDM 2.10)","morfologia matemática, sem treino","navegador (JS) · referência em Python"],
      ["CDM-3","fusão espacial / multivista para modelos 3D","navegador"],
      ["OpenCV Crack Baseline","limiarização + bordas","navegador"],
      ["YOLO, U-Net, SegFormer, CrackenPy (públicos)","redes neurais ONNX","navegador (WebGPU/WASM)"],
      ["Grounding DINO, OWLv2, CLIPSeg, SAM2 …","vocabulário aberto","servidor opcional"]]}/>
    <Note>Este manual descreve o comportamento do motor <b>CDM 2.10</b>, o padrão do Studio. Os demais motores aparecem em <i>Ajuda › Navegador de motores</i> (página de Configurações).</Note>
  </>},

  {id:"ui",title:"Interface",kw:"menus barra lateral canvas painéis status",body:<>
    <FigInterface n={f()}/>
    <Tbl head={["Região","Função"]} rows={[
      ["① Menus","Arquivo (importar, recentes com miniatura, salvar, imprimir, fechar, sair), Editar, Visualizar (modos, camadas, réguas), Análise (executar, motores, temporal), Ajuda."],
      ["② Barra lateral","Ferramentas rápidas: importar, executar, caixas, rótulos, Original/Sobrepor/Deslizar/Lado a lado, régua, Live, câmera, paridade (ícone CDM) e Sobre."],
      ["③ Imagem","Propriedades do arquivo, resolução, escala mm/px, qualidade e ajustes de tom."],
      ["④ Resultados","Contagens por patologia, total, lista de achados com medidas; expande para o dobro da largura."],
      ["⑤ Canvas","Imagem com sobreposição das máscaras, caixas e rótulos; navegação estilo CAD."],
      ["⑥ Etapas","Miniaturas de cada estágio do motor (cinza, black-hat, candidatos, esqueleto…)."],
      ["⑦ Réguas","Horizontal e vertical, graduadas em mm (ou px) conforme a escala configurada."],
      ["⑧ Status","Mensagens, progresso do motor, zoom e coordenadas do cursor."]]}/>
    <h3>Modos de visualização</h3>
    <ul>
      <li><b>Original</b> — só a imagem. <b>Sobrepor</b> — máscaras coloridas sobre a imagem.</li>
      <li><b>Deslizar</b> — cortina arrastável entre original e resultado. <b>Lado a lado</b> — as duas vistas sincronizadas.</li>
    </ul>
    <h3>Menu de contexto</h3>
    <p>O botão direito sobre o canvas abre ações do ponto: ajustar à tela, alternar camadas, copiar coordenadas, abrir as propriedades do achado sob o cursor.</p>
    <h3>Ajuda contextual</h3>
    <p>Com <i>Ajuda › Ajuda por contexto</i> (<K>Shift+F1</K>) o cursor vira “?”; clique em qualquer controle para ver o que ele faz. <K>/</K> abre a busca de comandos e <K>?</K> os atalhos.</p>
  </>},

  {id:"nav",title:"Navegação e atalhos",kw:"zoom pan roda teclado mouse atalhos",body:<>
    <p>O canvas segue a convenção de programas CAD: a roda aproxima <b>no ponto do cursor</b>, o botão do meio arrasta e o duplo clique do meio ajusta à tela.</p>
    <Eq n={e()} label="zoom no cursor">{"s' = s \\cdot 1.0015^{-\\Delta_{roda}}, \\quad \\mathbf{t}' = \\mathbf{c} - \\frac{s'}{s}(\\mathbf{c} - \\mathbf{t})"}</Eq>
    <p>em que <M>{"s"}</M> é a escala atual, <M>{"\\mathbf{t}"}</M> a translação e <M>{"\\mathbf{c}"}</M> a posição do cursor; o ponto sob o cursor permanece fixo.</p>
    <div className="umShortcuts">{shortcuts.map(([g,items])=><section key={g}><b>{g}</b>{items.map(([k,v])=><div key={k}><kbd>{k}</kbd><span>{v}</span></div>)}</section>)}</div>
  </>},

  {id:"import",title:"Importação e qualidade",kw:"formatos importar nitidez ruído exposição laplaciano immerkaer",body:<>
    <h3>Formatos</h3>
    <p>Imagens: PNG, JPG/JPEG, WebP, BMP, SVG e AVIF. Modelos: GLB/GLTF, OBJ, PLY, STL, LAS, XYZ e IFC. Arraste o arquivo para o canvas, use <K>Ctrl/Cmd+O</K> ou um dos 10 recentes (<K>Alt+1…0</K>). Antes de substituir um trabalho não salvo, o Studio pede confirmação.</p>
    <h3>Diagnóstico de qualidade</h3>
    <p>Ao importar, a imagem é avaliada em luminância <M>{"Y"}</M>. A <b>nitidez</b> é a variância do Laplaciano discreto:</p>
    <div className="umKernels"><Kernel title="Laplaciano L" m={[[0,1,0],[1,-4,1],[0,1,0]]}/><Kernel title="Immerkær N" m={[[1,-2,1],[-2,4,-2],[1,-2,1]]}/></div>
    <Eq n={e()}>{"S = \\op{var}(L \\ast Y) = \\frac{1}{n}\\sum (L \\ast Y)^2 - \\left(\\frac{1}{n}\\sum L \\ast Y\\right)^2"}</Eq>
    <p>O <b>ruído</b> é estimado pelo método de Immerkær (1996), robusto a bordas:</p>
    <Eq n={e()}>{"\\sigma = \\sqrt{\\frac{\\pi}{2}} \\cdot \\frac{1}{6n}\\sum |N \\ast Y|"}</Eq>
    <Tbl head={["Indicador","Atenção","Ruim"]} rows={[
      ["Nitidez S (var. Laplaciano)","< 110","< 40"],
      ["Ruído σ","> 7","> 14"],
      ["Exposição (média de Y)","< 55 ou > 200","< 30 ou > 225"],
      ["Pixels saturados (0 ou 255)","> 8 %","> 20 %"],
      ["Faixa dinâmica p98 − p2","< 75","< 40"],
      ["Dominante de cor |R/G − 1|, |B/G − 1|","> 0,12","> 0,25"]]}/>
    <Eq n={e()}>{"\\op{nota} = 100 - 25 \\cdot n_{ruim} - 8 \\cdot n_{atenção}"}</Eq>
    <h3>Ajuste de tom</h3>
    <p>Os ajustes do painel Imagem (exposição <M>{"e"}</M>, contraste <M>{"c"}</M>, curva S <M>{"s"}</M> e gama <M>{"\\gamma"}</M>) são aplicados por uma curva de tom antes da análise, com <M>{"v \\in [0,1]"}</M>:</p>
    <Eq n={e()}>{"v_1 = \\op{clip}(v \\cdot 2^{e}), \\quad v_2 = 0.5 + (v_1 - 0.5)\\left(1 + \\frac{c}{100}\\right)"}</Eq>
    <Eq n={e()}>{"v_3 = (1 - s)\\, v_2 + s \\cdot \\frac{1}{1 + e^{-k(v_2 - 0.5)}}, \\quad k = 2 + 10s, \\quad v_{out} = v_3^{1/\\gamma}"}</Eq>
    <Note kind="warn">Imagens com nota baixa ainda são analisadas, mas fissuras finas podem ser perdidas (desfoque) ou inventadas (ruído). Prefira refotografar.</Note>
  </>},

  {id:"pre",title:"Pré-processamento",kw:"cinza luminância contraste percentil estiramento",body:<>
    <p>O motor CDM trabalha sobre a luminância em tons de cinza (ITU-R BT.601):</p>
    <Eq n={e()}>{"Y = 0.299R + 0.587G + 0.114B"}</Eq>
    <p>Em seguida aplica um estiramento de contraste robusto entre os percentis 2 e 98, que neutraliza variações de exposição entre fotos:</p>
    <Eq n={e()}>{"I = \\op{clip}\\left(\\frac{Y - p_{2}}{p_{98} - p_{2}} \\cdot 255,\\; 0,\\; 255\\right)"}</Eq>
    <p>Os percentis são obtidos por <i>quickselect</i> com partição em três vias (eficiente mesmo com muitos valores repetidos). Para os critérios de cor, a imagem também é convertida para HSV em dupla precisão:</p>
    <Eq n={e()}>{"V = \\max(R,G,B), \\quad S = \\frac{V - \\min(R,G,B)}{V}, \\quad H \\in [0°, 360°)"}</Eq>
    <h3>Morfologia básica</h3>
    <p>Com elemento estruturante quadrado <M>{"B_k"}</M> de lado <M>{"k"}</M> (ímpar):</p>
    <Eq n={e()}>{"\\delta_k(I) = \\max_{B_k} I, \\quad \\varepsilon_k(I) = \\min_{B_k} I, \\quad \\gamma_k = \\delta_k \\circ \\varepsilon_k, \\quad \\varphi_k = \\varepsilon_k \\circ \\delta_k"}</Eq>
    <p>δ = dilatação, ε = erosão, γ = abertura (remove pontos claros pequenos), φ = fechamento (preenche vales escuros pequenos).</p>
  </>},

  {id:"cracks",title:"Fissuras",kw:"black-hat fissura esqueleto zhang suen comprimento largura reconstrução poda",body:<>
    <h3>1 · Realce por black-hat</h3>
    <p>Fissuras são vales escuros e estreitos. O <b>black-hat</b> (fechamento menos a imagem) isola exatamente as estruturas escuras mais finas que o elemento estruturante:</p>
    <Eq n={e()}>{"BH_k(I) = \\varphi_k(I) - I, \\qquad C = \\{ p : BH_k(I)(p) > T \\}"}</Eq>
    <FigBlackHat n={f()}/>
    <h3>2 · Reconstrução e limpeza</h3>
    <ol>
      <li><b>Sementes</b>: abertura 3×3 dos candidatos <M>{"C"}</M> — pontos que resistem à abertura são núcleos confiáveis.</li>
      <li><b>Reconstrução por abertura</b>: mantêm-se os componentes conexos de <M>{"C"}</M> que contêm alguma semente — remove ruído isolado sem encurtar as fissuras.</li>
      <li><b>Fechamento 3×3</b> para unir falhas de 1 px.</li>
      <li><b>Filtro de fragmentos</b>: um componente fica se tiver ≥ 3 px e (alongamento ≥ 2 ou área ≥ 4·A<sub>min</sub>).</li>
      <li><b>Ponte</b> de lacunas de até 4 px (fechamento 9×9 restrito) entre trechos alinhados.</li>
      <li>A corrosão detectada é <b>subtraída</b> da máscara de fissuras (separação de famílias).</li>
    </ol>
    <h3>3 · Esqueleto e medidas</h3>
    <p>Cada componente é afinado por <b>Zhang–Suen</b> até 1 px; ramos espúrios de até 12 px até uma junção são podados. O comprimento vem do percurso em profundidade do esqueleto, simplificado por Ramer–Douglas–Peucker (ε = 0,8 px); como o percurso passa duas vezes por cada trecho, toma-se metade:</p>
    <Eq n={e()}>{"L = \\frac{1}{2}\\sum_{i} \\left\\| p_{i+1} - p_{i} \\right\\|, \\qquad \\bar{w} = \\frac{A}{L}, \\qquad \\lambda = \\frac{L^2}{A}"}</Eq>
    <FigSkeleton n={f()}/>
    <p>São aceitas fissuras com alongamento <M>{"\\lambda \\ge \\lambda_{min}"}</M> (padrão 2), área ≥ <M>{"A_{min}"}</M> (padrão 30 px²) e comprimento ≥ 3 % do maior lado da imagem. Com escala definida, <M>{"L_{mm} = L \\cdot s"}</M> e <M>{"w_{mm} = \\bar{w} \\cdot s"}</M>, sendo <M>{"s"}</M> em mm/px.</p>
    <Tbl head={["Parâmetro","Padrão","Efeito ao aumentar"]} rows={[
      ["k (black-hat)","15 px (ímpar)","detecta fissuras/manchas mais largas"],
      ["T (limiar)","35","menos falsos positivos, perde fissuras tênues"],
      ["A_min","30 px²","descarta achados pequenos"],
      ["λ_min (alongamento)","2","exige formas mais lineares"]]}/>
  </>},

  {id:"areas",title:"Desplacamento, armadura, corrosão e eflorescência",kw:"desplacamento lascamento armadura exposta corrosão ferrugem eflorescência hsv",body:<>
    <h3>Desplacamento (lascamento)</h3>
    <p>Regiões escuras ou de textura áspera, com limiar adaptativo ao percentil 18 de cinza:</p>
    <Eq n={e()}>{"t_d = \\min(120,\\; p_{18} + \\max(8,\\; 0.25T)), \\quad k' = \\max(5, \\min(k, 21))"}</Eq>
    <Eq n={e()}>{"D = \\{ I < t_d \\} \\cup \\{ BH_{k'}(I) > \\max(10,\\, 0.55T) \\land I < p_{45} \\}"}</Eq>
    <p>Seguem abertura e fechamento 5×5.</p>
    <h3>Armadura exposta</h3>
    <p>Procurada somente <b>dentro</b> do desplacamento: pixels muito escuros em relação à própria região, ou acinzentados e foscos; limpeza 3×3 e alongamento ≥ max(2, λ<sub>min</sub>):</p>
    <Eq n={e()}>{"R_b = D \\cap \\left( \\{ I < p_{40}(D) \\} \\cup \\{ S < 0.20 \\land V < 0.55 \\} \\right)"}</Eq>
    <h3>Corrosão</h3>
    <Eq n={e()}>{"R > G + 12 \\;\\land\\; R > B + 18 \\;\\land\\; S > 0.22 \\;\\land\\; V > 0.16 \\;\\land\\; (H < 55° \\lor H > 330°)"}</Eq>
    <h3>Eflorescência</h3>
    <Eq n={e()}>{"V > 0.72 \\;\\land\\; S < 0.28 \\;\\land\\; I > p_{72}"}</Eq>
    <FigHsv n={f()}/>
    <h3>Separação de famílias (CDM 2.10)</h3>
    <p>As camadas são mantidas separadas para que cada pixel tenha uma natureza patológica dominante:</p>
    <ul>
      <li>Corrosão é removida da máscara de fissuras.</li>
      <li>Um componente de desplacamento com ≥ 60 % de corrosão passa a ser corrosão; a armadura dentro dele é removida e o restante recebe abertura 5×5.</li>
      <li>Abaixo de 60 %, as famílias ficam aninhadas: desplacamento contém armadura, e ambos podem coexistir com manchas de corrosão.</li>
    </ul>
    <FigFamilies n={f()}/>
  </>},

  {id:"results",title:"Regiões, caixas e resultados",kw:"consolidação caixa rótulo resultado achados lista medidas",body:<>
    <p>Cada componente conexo vira um <b>achado</b> com identificador (por exemplo, <code>F1</code> fissura, <code>D2</code> desplacamento, <code>A1</code> armadura, <code>C3</code> corrosão, <code>E1</code> eflorescência), caixa delimitadora, área, centroide e — para fissuras — comprimento e largura média.</p>
    <h3>Consolidação</h3>
    <Eq n={e()}>{"A_{min,cls} = \\max\\left(A_{min},\\; 0.0005 \\cdot A_{img},\\; 0.08 \\cdot A_{maior,cls}\\right)"}</Eq>
    <p>Achados abaixo desse limite são descartados como irrelevantes; uma caixa com ≥ 80 % de sua área dentro de outra maior da mesma classe é absorvida (as áreas são somadas), evitando caixas repetidas.</p>
    <FigConsolidation n={f()}/>
    <h3>Filtro de contexto IA</h3>
    <p>Opcional (Configurações › CDM-1). Um SegFormer-B0 treinado no ADE20K (150 classes de cena) roda no navegador e classifica cada região da foto. O CDM continua rodando na imagem inteira; <b>depois</b>, cada componente <M>{"K"}</M> é descartado se a fração de sua área sobre regiões irrelevantes <M>{"X"}</M> (céu, vegetação, solo, água, veículos, pessoas, placas, postes; no modo estrito, tudo que não for estrutura) atingir o limiar <M>{"\\tau"}</M> (padrão 0,6):</p>
    <Eq n={e()}>{"\\text{descarta } K \\iff \\frac{|K \\cap X|}{|K|} \\ge \\tau"}</Eq>
    <p>A IA só remove falsos positivos: não cria achados nem altera medidas, e a paridade JS ⇄ Python do CDM é preservada. Se a cena não for reconhecida (mais de 90 % irrelevante e menos de 3 % de estrutura, típico de close-ups), o filtro se abstém. A etapa “Filtro de contexto IA” mostra o mapa usado (vermelho = irrelevante, verde = estrutura).</p>
    <h3>Painel Resultados</h3>
    <ul>
      <li>Linha por patologia com o número de achados antes do total (área ou comprimento).</li>
      <li>Expandido, lista todos os achados com medidas; clique para centralizar no canvas.</li>
      <li><b>Caixas</b> e <b>rótulos</b> (barra lateral) exibem, sobre a imagem, o identificador e a medida resumida (ex.: <code>F1 · 182 mm · 0,24 mm</code>).</li>
    </ul>
  </>},

  {id:"rating",title:"Classificação de condição",kw:"gde grau de dano fator intensidade ponderação dnit nota técnica estado conservação",body:<>
    <p>Cada achado recebe um <b>fator de intensidade</b> <M>{"F_i \\in \\{1,2,3,4\\}"}</M> a partir de sua razão de área <M>{"a = A/A_{img}"}</M> (ou, para fissuras, largura e densidade linear) e um <b>fator de ponderação</b> <M>{"F_p"}</M> da patologia.</p>
    <Tbl head={["Patologia",<>F<sub>p</sub></>,<>F<sub>i</sub> = 1</>,<>F<sub>i</sub> = 2</>,<>F<sub>i</sub> = 3</>,<>F<sub>i</sub> = 4</>]} rows={[
      ["Fissuras","3","w ≤ 0,2 mm e ρ ≤ 0,05","w ≤ 0,4 e ρ ≤ 0,12","w ≤ 1,0 e ρ ≤ 0,30","acima"],
      ["Desplacamento","4","a ≤ 0,05 %","≤ 0,3 %","≤ 1,5 %","> 1,5 %"],
      ["Armadura exposta","5","—","a ≤ 0,02 %","≤ 0,15 %","> 0,15 %"],
      ["Corrosão","5","a ≤ 0,05 %","≤ 0,3 %","≤ 1,5 %","> 1,5 %"],
      ["Eflorescência","2","a ≤ 0,1 %","≤ 1 %","> 1 %","—"]]}/>
    <p>Para fissuras, <M>{"\\rho = L/\\sqrt{A_{img}}"}</M>; sem escala, os limites de largura passam a 2, 4 e 8 px.</p>
    <Eq n={e()}>{"D = 0.8 \\, F_i \\, F_p \\quad \\text{se } F_i \\le 2, \\qquad D = (12 F_i - 28) \\, F_p \\quad \\text{se } F_i \\ge 3"}</Eq>
    <Eq n={e()}>{"GDE = D_{max}\\left(1 + \\frac{\\sum D - D_{max}}{\\sum D}\\right)"}</Eq>
    <FigGde n={f()}/>
    <Tbl head={["GDE","Nível","Ação recomendada"]} rows={[
      ["0 – 15","Baixo","Estado aceitável; manutenção preventiva."],
      ["15 – 50","Médio","Planejar nova inspeção e intervenção em longo prazo."],
      ["50 – 80","Alto","Inspeção especializada e intervenção em médio prazo."],
      ["80 – 100","Sofrível","Inspeção especializada rigorosa e intervenção em curto prazo."],
      ["> 100","Crítico","Inspeção especializada imediata e medidas emergenciais."]]}/>
    <h3>Estado de conservação e nota técnica</h3>
    <p>Uma severidade <M>{"s \\in [0,1]"}</M> por achado (fissuras: <M>{"s = 0.65\\min(1, w/w_{ref}) + 0.35\\min(1, \\rho/0.3)"}</M>; áreas: razão normalizada) define o posto <M>{"r = 1 + \\#\\{t \\in \\{0.25, 0.5, 0.75\\} : s \\ge t\\}"}</M>. O posto do elemento sobe um nível (máx. 4) se houver ≥ 5 achados ou área afetada ≥ 1,5 %. EC = 5 − r (4 Bom, 3 Razoável, 2 Ruim, 1 Severo). A nota técnica NT considera a família do elemento (F<sub>r</sub> 1–5): elementos principais (F<sub>r</sub> ≥ 4) usam o posto direto; os demais, um nível mais brando.</p>
    <Note kind="warn">A classificação é <b>por imagem</b> e indicativa. Ela não substitui a inspeção especial prevista nas normas (NBR 9452, manuais DNIT); serve para triagem e acompanhamento.</Note>
  </>},

  {id:"temporal",title:"Comparação temporal",kw:"temporal t0 t1 registro alinhamento crescimento redução iou",body:<>
    <p>Em <i>Análise › Comparação temporal</i>, importe a imagem de referência (t0). As máscaras das duas datas são comparadas após registro por translação, buscando o deslocamento que maximiza a semelhança dos mapas de bordas <M>{"E_0, E_1"}</M>:</p>
    <Eq n={e()}>{"(\\Delta x, \\Delta y) = \\op{argmax}_{|\\Delta x|,|\\Delta y| \\le s} \\; \\op{sim}\\left(E_1,\\, E_0(x - \\Delta x,\\, y - \\Delta y)\\right)"}</Eq>
    <FigTemporal n={f()}/>
    <Eq n={e()}>{"IoU = \\frac{|M_0 \\cap M_1|}{|M_0 \\cup M_1|}, \\quad G = M_1 \\setminus M_0, \\quad R = M_0 \\setminus M_1, \\quad \\Delta A = |M_1| - |M_0|"}</Eq>
    <h3>Validação do par</h3>
    <p>O par só é aceito se a sobreposição e a semelhança forem suficientes; caso contrário o Studio avisa antes de executar.</p>
    <Tbl head={["Critério","Atenção","Reprovado"]} rows={[
      ["Sobreposição após registro","< 92 %","< 85 %"],
      ["Diferença de iluminação","> 0,12","> 0,22"],
      ["Razão de nitidez t0/t1","< 0,65","< 0,45"],
      ["Semelhança de bordas","< 0,55","< 0,35"],
      ["Pixels saturados","> 20 %","> 35 %"]]}/>
    <p>Fotografe as campanhas do mesmo ponto, com a mesma distância focal e iluminação semelhante; o registro corrige apenas translação.</p>
  </>},

  {id:"scale",title:"Escala, réguas e calibração",kw:"régua escala mm px calibração milímetro",body:<>
    <p>As medidas são convertidas para milímetros pela escala <M>{"s"}</M> (mm/px), editável em <i>Configurações › Escala</i> ou no painel Imagem. Com um objeto de referência de comprimento conhecido:</p>
    <Eq n={e()}>{"s = \\frac{L_{ref,mm}}{L_{ref,px}}, \\qquad L_{mm} = s \\cdot L_{px}, \\qquad A_{mm^2} = s^2 \\cdot A_{px}"}</Eq>
    <FigCalibration n={f()}/>
    <p>As réguas (<K>Ctrl/Cmd+Shift+R</K> ou o ícone de régua) acompanham zoom e deslocamento; clique no canto para alternar mm/cm/px. Sem escala, tudo é exibido em pixels.</p>
    <Note>A escala vale para o plano da superfície fotografada. Fotos oblíquas distorcem medidas; para larguras de fissura, fotografe perpendicularmente e inclua a referência no mesmo plano.</Note>
  </>},

  {id:"parity",title:"Paridade JS ⇄ Python",kw:"paridade pyodide python javascript métricas bland altman iou pmr",body:<>
    <p>O motor do navegador (JavaScript) é verificado contra a implementação de referência em Python (<code>cdm_v285.py</code>). O ícone <b>CDM</b> da barra lateral abre o painel de Paridade com duas fontes: <b>Cenas de teste</b> (relatório gerado na integração contínua) e <b>Esta imagem</b> (executa o Python no próprio navegador via Pyodide, em 24 variações da imagem atual ≤ 384 px).</p>
    <Eq n={e()}>{"PMR = \\frac{\\#\\{p : M_{JS}(p) = M_{Py}(p)\\}}{N}, \\qquad IoU_{cls} = \\frac{|M_{JS} \\cap M_{Py}|}{|M_{JS} \\cup M_{Py}|}"}</Eq>
    <Eq n={e()}>{"L_\\infty = \\max_p |I_{JS}(p) - I_{Py}(p)|, \\qquad \\varepsilon_{rel} = \\frac{|m_{JS} - m_{Py}|}{\\max(|m_{Py}|, 1)} \\le 1\\%"}</Eq>
    <Eq n={e()}>{"\\bar{d} = \\frac{1}{n}\\sum (m_{JS} - m_{Py}), \\qquad LoA = \\bar{d} \\pm 1.96\\, \\sigma_d"}</Eq>
    <FigBlandAltman n={f()}/>
    <Tbl head={["Aba","Mostra"]} rows={[
      ["Resumo","PMR, IoU por classe, erro máximo, veredito"],["Cascata","diferenças acumuladas estágio a estágio"],
      ["Bland-Altman","viés e limites de concordância das medidas"],["Dispersão","JS × Python com a reta identidade"],
      ["Matriz","confusão multirrótulo por classe"],["Divergência","mapa dos pixels discordantes"]]}/>
    <p>Todos os gráficos exportam em SVG, PNG, CSV e JSON.</p>
  </>},

  {id:"files",title:"Salvar, exportar e imprimir",kw:"exportar salvar csv svg coco dxf ifc html imprimir histórico recentes",body:<>
    <Tbl head={["Formato","Conteúdo","Uso típico"]} rows={[
      ["CSV","uma linha por achado com medidas e classificação","planilhas, estatística"],
      ["SVG","contornos vetoriais por camada","figuras, edição vetorial"],
      ["COCO JSON","polígonos e caixas por categoria","treinar/avaliar redes"],
      ["DXF","polilinhas por camada","CAD"],
      ["BIM JSON / IFC","IfcAnnotation com propriedades dos danos","modelos BIM"],
      ["HTML","relatório completo com imagem e tabelas","entrega/arquivo"]]}/>
    <ul>
      <li><b>Salvar</b> (<K>Ctrl/Cmd+S</K>) grava a inspeção no histórico local do navegador (IndexedDB), com miniatura.</li>
      <li><b>Recentes</b>: os 10 últimos, com miniatura, em <i>Arquivo › Abrir recente</i>.</li>
      <li><b>Imprimir</b> (<K>Ctrl/Cmd+P</K>) imprime somente o canvas e os resultados.</li>
      <li><b>Fechar visualização</b> limpa o canvas; <b>Sair</b> tenta fechar a janela e, se o navegador impedir, indica como fechá-la.</li>
    </ul>
  </>},

  {id:"limits",title:"Boas práticas e limitações",kw:"limitações boas práticas fotografia referências glossário",body:<>
    <h3>Fotografia</h3>
    <ul>
      <li>Câmera perpendicular à superfície, foco na região de interesse, ISO baixo.</li>
      <li>Luz difusa; evite sombras projetadas duras (podem virar desplacamento) e reflexos.</li>
      <li>Inclua uma referência métrica no plano para calibrar a escala.</li>
    </ul>
    <h3>Limitações conhecidas</h3>
    <ul>
      <li>Juntas, sulcos de forma e manchas lineares podem ser lidos como fissuras — revise os achados.</li>
      <li>Superfícies muito escuras ou molhadas reduzem o contraste do black-hat.</li>
      <li>Larguras abaixo de ~1 px não são medidas com confiança: dependem da resolução.</li>
      <li>A classificação GDE/EC é indicativa e por imagem.</li>
    </ul>
    <h3>Glossário</h3>
    <Tbl head={["Termo","Significado"]} rows={[
      ["Elemento estruturante","janela (k×k) usada nas operações morfológicas"],
      ["Black-hat","fechamento menos imagem; realça vales escuros finos"],
      ["Esqueleto","linha central de 1 px de uma região"],
      ["IoU","interseção sobre união de duas máscaras"],
      ["GDE","grau de dano do elemento"],
      ["Pyodide","Python compilado para WebAssembly, executado no navegador"]]}/>
    <h3>Referências</h3>
    <ul className="umRefs">
      <li>Soille, P. <i>Morphological Image Analysis</i>. Springer, 2003.</li>
      <li>Zhang, T. Y.; Suen, C. Y. A fast parallel algorithm for thinning digital patterns. <i>Comm. ACM</i> 27(3), 1984.</li>
      <li>Immerkær, J. Fast noise variance estimation. <i>CVIU</i> 64(2), 1996.</li>
      <li>Douglas, D.; Peucker, T. Algorithms for the reduction of the number of points… <i>Cartographica</i> 10(2), 1973.</li>
      <li>Bland, J. M.; Altman, D. G. Statistical methods for assessing agreement… <i>The Lancet</i>, 1986.</li>
      <li>ABNT NBR 9452 — Inspeção de pontes, viadutos e passarelas de concreto.</li>
    </ul>
  </>}
  ];
}

export default function UserManual({onClose,shortcuts=[]}){
  const list=useMemo(()=>chapters(shortcuts),[shortcuts]);
  const[idx,setIdx]=useState(()=>{try{const v=+sessionStorage.getItem("shmManualPage");return v>=0&&v<list.length?v:0}catch{return 0}});
  const[q,setQ]=useState("");
  const body=useRef(null),ref=useRef(null),closeRef=useRef(onClose);closeRef.current=onClose;
  const norm=s=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  const visible=list.map((c,i)=>[c,i]).filter(([c])=>!q||norm(c.title+" "+c.kw).includes(norm(q)));
  const go=i=>{const n=Math.max(0,Math.min(list.length-1,i));setIdx(n);try{sessionStorage.setItem("shmManualPage",String(n))}catch{}};
  useEffect(()=>{body.current?.scrollTo?.(0,0)},[idx]);
  useEffect(()=>{
    const prev=document.activeElement;ref.current?.querySelector(".umBody")?.focus();
    const key=ev=>{
      if(ev.key==="Escape"){ev.preventDefault();ev.stopPropagation();closeRef.current();return}
      if(ev.target?.tagName==="INPUT")return;
      if(ev.key==="ArrowRight"||ev.key==="PageDown"){ev.preventDefault();setIdx(i=>{const n=Math.min(list.length-1,i+1);try{sessionStorage.setItem("shmManualPage",String(n))}catch{}return n})}
      if(ev.key==="ArrowLeft"||ev.key==="PageUp"){ev.preventDefault();setIdx(i=>{const n=Math.max(0,i-1);try{sessionStorage.setItem("shmManualPage",String(n))}catch{}return n})}
    };
    window.addEventListener("keydown",key,true);
    return()=>{window.removeEventListener("keydown",key,true);prev?.focus?.()};
  },[list.length]);
  const ch=list[idx];
  // Imprime todos os capítulos num iframe isolado (o layout do Studio tem altura fixa e cortaria as páginas).
  const print=()=>{
    const pages=ref.current?.querySelector(".umPages");if(!pages)return;
    let css="";for(const sh of Array.from(document.styleSheets)){try{css+=Array.from(sh.cssRules).map(r=>r.cssText).join("\n")}catch{}}
    const fr=document.createElement("iframe");fr.setAttribute("aria-hidden","true");fr.style.cssText="position:fixed;width:0;height:0;border:0;right:0;bottom:0";
    document.body.appendChild(fr);
    const d=fr.contentDocument;d.open();d.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Manual do usuário · SHM Studio</title><style>'+css+'</style></head><body class="umPrintDoc" style="background:#fff"><h1 style="font:700 24px system-ui;margin:0 0 6px">Manual do usuário · SHM Studio</h1></body></html>');d.close();
    d.body.appendChild(d.importNode(pages,true));
    setTimeout(()=>{try{fr.contentWindow.focus();fr.contentWindow.print()}finally{setTimeout(()=>fr.remove(),1000)}},120);
  };
  return <div className="studioHelpScrim" onMouseDown={ev=>{if(ev.target===ev.currentTarget)onClose()}}>
    <div ref={ref} className="studioHelpDialog large userManual" role="dialog" aria-modal="true" aria-label="Manual do usuário">
      <header><b><BookOpen size={15}/> Manual do usuário · SHM Studio</b><span className="umHeadActions"><button type="button" onClick={print} aria-label="Imprimir manual" title="Imprimir / salvar como PDF"><Printer size={15}/></button><button type="button" onClick={onClose} aria-label="Fechar"><X size={16}/></button></span></header>
      <div className="umLayout">
        <nav className="umToc" aria-label="Capítulos">
          <label className="umSearch"><Search size={13}/><input value={q} onChange={ev=>setQ(ev.target.value)} placeholder="Procurar no manual" aria-label="Procurar no manual"/></label>
          <ol>{visible.map(([c,i])=><li key={c.id}><button type="button" className={i===idx?"active":""} aria-current={i===idx?"page":undefined} onClick={()=>go(i)}><span>{i+1}</span>{c.title}</button></li>)}</ol>
          {!visible.length&&<p className="umEmpty">Nenhum capítulo encontrado.</p>}
        </nav>
        <article className="umBody" ref={body} tabIndex="-1" aria-live="polite">
          <div className="umPages">{list.map((c,i)=><section key={c.id} className={"umPage"+(i===idx?" current":"")} aria-hidden={i!==idx||undefined}>
            <small className="umKicker">Capítulo {i+1} de {list.length}</small><h2>{c.title}</h2>{c.body}
          </section>)}</div>
        </article>
      </div>
      <footer>
        <div className="umDots" aria-hidden="true">{list.map((c,i)=><button key={c.id} type="button" tabIndex="-1" className={i===idx?"on":""} onClick={()=>go(i)} title={c.title}/>)}</div>
        <small>{idx+1} / {list.length} · {ch.title} · ← → para virar a página</small>
        <button type="button" onClick={()=>go(idx-1)} disabled={idx===0}><ChevronLeft size={14}/> Anterior</button>
        <button type="button" className="primary" onClick={()=>go(idx+1)} disabled={idx===list.length-1}>Próximo <ChevronRight size={14}/></button>
      </footer>
    </div>
  </div>;
}
