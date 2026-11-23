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
      ["CDM-4","CDM 2.11 + diversidade de Ataky + random walker + armadura linear (experimental)","navegador (Web Worker)"],
      ["OpenCV Crack Baseline","limiarização + bordas","navegador"],
      ["YOLO, U-Net, SegFormer, CrackenPy (públicos)","redes neurais ONNX","navegador (WebGPU/WASM)"],
      ["Grounding DINO, OWLv2, CLIPSeg, SAM2 …","vocabulário aberto","servidor opcional"]]}/>
    <Note>Este manual descreve o comportamento do motor <b>CDM 2.10</b>, o padrão do Studio. Os demais motores aparecem em <i>Ajuda › Navegador de motores</i> (página de Configurações). O <b>CDM-4</b> tem capítulo próprio.</Note>
  </>},

  {id:"ui",title:"Interface",kw:"menus barra lateral canvas painéis status",body:<>
    <FigInterface n={f()}/>
    <Tbl head={["Região","Função"]} rows={[
      ["① Menus","Arquivo (importar, recentes com miniatura, salvar, imprimir, fechar, sair), Editar, Visualizar (modos, camadas, réguas), Análise (configurações, executar, anotação Ground Truth, Campo do walker e Corte de nível do CDM-4, paridade), Ajuda."],
      ["② Barra lateral","Ferramentas rápidas: importar, executar, caixas, rótulos, Original/Sobrepor/Deslizar/Lado a lado, régua, Live, câmera, paridade (ícone CDM), Campo do walker (mira, CDM-4), Corte de nível (tesoura, CDM-4) e Sobre."],
      ["③ Imagem","Propriedades do arquivo, resolução, escala mm/px, qualidade e ajustes de tom."],
      ["④ Resultados","Contagens por patologia, total, lista de achados com medidas; expande para o dobro da largura."],
      ["⑤ Canvas","Imagem com sobreposição das máscaras, caixas e rótulos; navegação estilo CAD."],
      ["⑥ Etapas","Miniaturas de cada estágio do motor (cinza, black-hat, candidatos, esqueleto…); clique para ampliar e baixar."],
      ["⑦ Réguas","Horizontal e vertical, graduadas em mm (ou px) conforme a escala configurada."],
      ["⑧ Status","Mensagens, progresso do motor, idioma (PT · EN · ES · FR), zoom e coordenadas do cursor."]]}/>
    <h3>Idioma</h3>
    <p>O seletor <b>PT · EN · ES · FR</b> fica na barra de status, à esquerda do zoom. A troca vale na hora para menus, painéis, etapas e para as figuras e relatórios exportados (legendas, nomes de camadas do SVG e relatório HTML saem no idioma escolhido, com a vírgula ou o ponto decimal correspondente). A escolha fica guardada no navegador; o padrão é português. Este manual permanece em português.</p>
    <h3>Modos de visualização</h3>
    <ul>
      <li><b>Original</b> — só a imagem. <b>Sobrepor</b> — máscaras coloridas sobre a imagem.</li>
      <li><b>Deslizar</b> — cortina arrastável entre original e resultado. <b>Lado a lado</b> — as duas vistas sincronizadas.</li>
    </ul>
    <h3>Menu de contexto</h3>
    <p>O botão direito sobre o canvas abre ações do ponto: ajustar à tela, alternar camadas, copiar coordenadas, abrir as propriedades do achado sob o cursor. A seção <i>Studio</i> do menu inclui executar, importar, Live, câmera, paridade, Campo do walker e configurações.</p>
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
    <p>CDM 2.11: o ganho do estiramento é limitado a 2,4 (superfícies lisas de baixo contraste não têm ruído amplificado), e uma <b>moldura uniforme</b> (borda branca ou preta de figura escaneada/print; linhas e colunas com variação ≤ 10 níveis, até 25 % por lado) fica fora da análise: os percentis usam só o conteúdo e a moldura recebe o pixel de conteúdo mais próximo, sem degrau artificial.</p>
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
    <p>A largura média precisa ser ≤ 0,45·k (manchas largas de textura não são fissuras). São aceitas fissuras com alongamento <M>{"\\lambda \\ge \\lambda_{min}"}</M> (padrão 2), área ≥ <M>{"A_{min}"}</M> (padrão 30 px²) e comprimento ≥ 4 % do maior lado da imagem. Com escala definida, <M>{"L_{mm} = L \\cdot s"}</M> e <M>{"w_{mm} = \\bar{w} \\cdot s"}</M>, sendo <M>{"s"}</M> em mm/px.</p>
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
    <p>Seguem abertura e fechamento 5×5. No CDM 2.11, três regras evitam que manchas e texturas do concreto virem desplacamento:</p>
    <ul>
      <li><b>Núcleo + crescimento</b>: abertura 9×9 encontra núcleos robustos e a região só cresce 3 px a partir deles — pontes finas de textura não ligam manchas distintas.</li>
      <li><b>Contraste local</b>: <M>{"\\bar{I}_{coroa} - \\bar{I}_{D} \\ge \\max(40,\\; 1.2\\,T)"}</M>, com a coroa tomada numa caixa 7 px maior que o componente; manchas e sombras rasas saem.</li>
      <li><b>Suavização</b>: fechamento 11×11 dos desplacamentos aceitos, para que agregado claro na borda não recorte o contorno.</li>
      <li><b>Rugosidade</b>: média de <M>{"|Y - \\bar{Y}_{5 \\times 5}|"}</M> no componente ≥ 5 níveis de cinza — agregado exposto é áspero; sombra, vinheta e mancha são lisas.</li>
      <li><b>Borda</b>: regiões de área com menos de 1 % do conteúdo encostadas na borda da imagem/moldura são parciais e saem (também corrosão e eflorescência).</li>
    </ul>
    <h3>Armadura exposta</h3>
    <p>Procurada somente <b>dentro</b> do desplacamento: pixels muito escuros em relação à própria região, ou acinzentados e foscos; limpeza 3×3, alongamento ≥ max(3, λ<sub>min</sub>), comprimento ≥ 4 % do maior lado e área ≥ 2·A<sub>min</sub> (forma de barra):</p>
    <Eq n={e()}>{"R_b = D \\cap \\left( \\{ I < p_{40}(D) \\} \\cup \\{ S < 0.20 \\land V < 0.55 \\} \\right)"}</Eq>
    <h3>Corrosão</h3>
    <Eq n={e()}>{"R > G + 12 \\;\\land\\; R > B + 18 \\;\\land\\; S > 0.22 \\;\\land\\; V > 0.16 \\;\\land\\; (H < 55° \\lor H > 330°)"}</Eq>
    <h3>Eflorescência</h3>
    <Eq n={e()}>{"V > 0.72 \\;\\land\\; S < 0.28 \\;\\land\\; I > p_{72}"}</Eq>
    <p>CDM 2.11: cada região precisa ser mais clara que o entorno imediato em pelo menos <M>{"\\max(80,\\; 2.2\\,T)"}</M> níveis (cinza estirado) — concreto claro e reflexos amplos não viram eflorescência.</p>
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

  {id:"cdm4",title:"Motor CDM-4 (experimental)",kw:"cdm-4 random walker grady ataky diversidade biodiversidade evidência polos armadura linear pigmentos beer lambert contorno resolução cheia campo setas coerência iou corte de nível binarização otsu perfil terreno hipsométrica tesoura",body:<>
    <p className="umLead">O <b>CDM-4</b> é um motor próprio, separado do CDM-1 e do CDM-3: parte de uma cópia do CDM 2.11 e acrescenta as etapas validadas em fotos reais de inspeção. Continua determinístico e sem pesos treinados na segmentação; a IA de contexto só exclui cena. Roda no navegador, num Web Worker, e é escolhido na página de Configurações (<i>CDM-4 · etapas do núcleo</i>).</p>
    <Note kind="warn">Motor em validação: na foto de referência com Ground Truth, a IoU do desplacamento subiu de 26,6 (CDM 2.11) para cerca de 70 e a da armadura exposta de 13,2 para 53,6, mas ainda são poucas fotos anotadas. Confirme os achados em inspeção técnica.</Note>
    <h3>Dois fluxos para o desplacamento</h3>
    <Tbl head={["Fluxo","Sequência","Quando usar"]} rows={[
      ["Morfologia (padrão)","CDM 2.11 → diversidade e biodiversidade (Ataky) → random walker → final","fotos em que a morfologia já acerta o núcleo do dano"],
      ["Evidência","normalização contra o concreto saudável → polos por evidência → random walker → juiz de biodiversidade → contexto → final","quando a morfologia traz falsos núcleos que o walker espalharia; em geral dá contornos mais limpos"]]}/>
    <p>No fluxo por evidência, a rugosidade (desvio-padrão local) e a diversidade de Ataky (entropia de Shannon de 56 “espécies” de luminância × matiz) são medidas em <M>{"z"}</M> contra o concreto saudável da própria foto. O polo de dano exige evidência forte e núcleo espesso (bordas finas e quinas saem); o polo saudável é o concreto típico. Depois do walker, cada região precisa se distinguir do entorno saudável pela biodiversidade, senão é descartada.</p>
    <h3>Random walker (Grady)</h3>
    <p>Com os polos fixados (dano = 1, saudável = 0), o potencial <M>{"u"}</M> de cada pixel é a probabilidade de um passeio aleatório chegar primeiro ao polo de dano. Ele minimiza a energia de Dirichlet sobre a grade, com pesos que caem nas bordas de cor e textura:</p>
    <Eq n={e()}>{"\\min_u \\sum_{(i,j)} w_{ij}\\,(u_i - u_j)^2, \\quad w_{ij} = \\exp\\left(-\\beta\\,\\Vert g_i - g_j \\Vert^2\\right)"}</Eq>
    <p>onde <M>{"g"}</M> reúne luminância, oponentes de cor e diversidade, em <M>{"z"}</M> robusto. O sistema <M>{"L_U\\,u_U = -B\\,u_S"}</M> é resolvido por gradiente conjugado com pré-condicionador de Jacobi. O desplacamento é <M>{"u > \\tau"}</M> (padrão 0,3 no fluxo por morfologia e 0,5 no fluxo por evidência). Em fotos com menos de 1000 px de lado o walker roda na escala da foto, sem reduzir.</p>
    <h3>Opções do núcleo (Configurações › CDM-4)</h3>
    <Tbl head={["Opção","Padrão","Efeito"]} rows={[
      ["IA de contexto · F1, F4, F5","ligadas","terreno/água cercado pela estrutura vira neutro (F1); céu superexposto ligado à borda é excluído (F4); em close-up, “terreno” em mais de 50 % do quadro vira neutro (F5)"],
      ["Canal de diversidade e refino por biodiversidade","ligados","desplacamento como comunidade anômala de cor e textura; borda comparada ao concreto saudável vizinho"],
      ["Random walker","ligado","probabilidade de dano por pixel; limiar ajustável"],
      ["Armadura exposta por abertura linear","ligada","vales escuros, estreitos e longos (black-hat 21, segmento de 61 px em 12 orientações) dentro do desplacamento"],
      ["Walker em resolução cheia na fronteira","desligado","refaz o walker pixel a pixel em torno de cada desplacamento (caixa + 24 px), com os mesmos polos; dispensa o afinamento por limiar"],
      ["Afinamento automático do contorno","desligado","limiar por região em passos de 0,08 a 0,005 (±0,1) até a fronteira estabilizar (distância simétrica < 0,25 px)"],
      ["Pigmentos por Beer–Lambert","ligado","composição neutro / ferrugem / biológico de cada achado; só diagnóstico, não altera máscaras"]]}/>
    <Note>Na foto de referência, o <b>walker em resolução cheia</b> levou a IoU do desplacamento de 68,4 para 70,7 no fluxo por evidência (+0,7 s), mas baixou de 64,2 para 62,8 no fluxo por morfologia, porque ali os polos podem carregar falsos núcleos. Use-o com o fluxo por evidência. Ligado, ele tem prioridade sobre o afinamento do contorno.</Note>
    <h3>Etapas do CDM-4</h3>
    <p>O painel de etapas mostra, conforme o fluxo: entrada, evidências (rugosidade e diversidade) ou morfologia 2.11, polos, potencial do random walker com legenda de intensidade, juiz de biodiversidade, walker em resolução cheia ou afinamento do contorno (quando ligados), desplacamento final, armadura linear e pigmentos. Todas as figuras têm o mesmo tamanho, texto numa faixa semitransparente inferior e legenda horizontal; clique para ampliar e baixar no idioma ativo.</p>
    <h3>Campo do walker</h3>
    <p>Ferramenta de análise do potencial, disponível depois de uma análise do CDM-4: ícone de mira na barra lateral, <i>Análise › Campo do walker (CDM-4)</i> ou menu de contexto. Arraste um <b>quadrado 1:1</b> sobre a imagem (<K>Esc</K> cancela). Dentro dele o walker é refeito em <b>resolução cheia</b>, com os polos do motor (<i>u</i> ≥ 0,999 dano, <i>u</i> ≤ 0,001 saudável) e a borda do quadrado presa ao lado que o motor decidiu. Saem quatro figuras de 640 × 640 px:</p>
    <Tbl head={["Figura","Conteúdo"]} rows={[
      ["1 · Setas −∇u",<>malha de setas do campo, coloridas por <M>{"\\log_{10}|\\nabla u|"}</M>; contorno ciano tracejado = motor, branco = resolução cheia</>],
      ["2 · Desvio angular","rosa de 36 setores do ângulo entre cada seta e a direção que sai do polo de dano mais próximo; amarelo = vetor médio"],
      ["3 · Dispersão local","1 − R numa janela 9 × 9: 0 = setas alinhadas, 1 = direções espalhadas"],
      ["4 · Coerência por região","área do motor e da resolução cheia, R, |∇u| mediano e fração de platô de cada região, mais a tabela de IoU"]]}/>
    <Eq n={e()}>{"R = \\frac{1}{n}\\left|\\sum_{k=1}^{n} e^{\\,i\\,\\theta_k}\\right|, \\qquad \\text{dispersão local} = 1 - R_{9\\times 9}"}</Eq>
    <p><b>R ≥ 0,70</b>: o potencial cai de forma ordenada do dano para o saudável e a borda é confiável. R baixo ou |∇u| fraco indicam transição difusa, em que o limiar decide a borda; o <b>platô</b> é a parte da região sem gradiente (halo sem evidência).</p>
    <h4>Contorno do motor × resolução cheia</h4>
    <p>O motor resolve o walker em escala reduzida (cerca de 1600 px de lado) e amplia; por isso a borda ciana tem degraus e pode avançar alguns pixels sobre o concreto saudável. A borda branca é o mesmo problema resolvido pixel a pixel só dentro do quadrado: mesmos polos, mais detalhe na fronteira.</p>
    <h4>Tabela de IoU (figura 4)</h4>
    <ul>
      <li><b>Com Ground Truth</b> anotado na sessão (classe Desplacamento, em qualquer escala): IoU, precisão e revocação do contorno do motor e do de resolução cheia, só dentro do quadrado, e o ganho em pontos percentuais.</li>
      <li><b>Sem Ground Truth</b>: IoU de concordância motor × resolução cheia e Δ de área. Mede quanto os dois contornos divergem, não a acurácia; anote o desplacamento para obter a IoU real.</li>
    </ul>
    <p>Clique numa figura para ampliá-la (<K>←</K> <K>→</K> navegam, <K>Esc</K> fecha). Cada figura e o <b>painel 2×2</b> podem ser baixados em PNG, no idioma ativo; <i>Nova seleção</i> recomeça.</p>
    <h3>Corte de nível: binarização × potencial do walker</h3>
    <p>Estudo comparativo entre dois conceitos de corte, disponível depois de uma análise do CDM-4: ícone de <b>tesoura</b> na barra lateral, <i>Análise › Corte de nível (CDM-4)</i> ou menu de contexto. A <b>binarização</b> julga cada pixel sozinho pela escuridão normalizada (corte de Otsu). O <b>potencial</b> <i>u</i> do walker é a probabilidade de chegar primeiro ao polo de dano; pelo princípio do máximo, toda região com <M>{"u > \\tau"}</M> contém um polo de dano, e uma mancha escura sem ligação com o dano fica em <i>u</i> ≈ 0.</p>
    <ol>
      <li>Arraste <b>n linhas de corte</b> sobre a imagem, em qualquer direção. Elas recebem as letras A, B, C… <K>Backspace</K> desfaz o último corte; a lixeira limpa todos.</li>
      <li>Para cortes padronizados, segure <K>Ctrl</K> (<K>⌘</K> no Mac) enquanto arrasta, como no Inkscape: o ângulo anda em múltiplos de 15° e o comprimento em <b>passos</b> fixos (campo <i>Passo (Ctrl)</i>, padrão 20 px). Uma etiqueta junto ao cursor mostra comprimento e ângulo, para repetir cortes do mesmo tamanho ao longo do walker, inclusive inclinados. <K>Shift</K> trava na horizontal ou vertical.</li>
      <li>Em <b>Níveis do walker</b>, informe até cinco níveis separados por ponto e vírgula (padrão <i>0,3; 0,5</i>). O limiar do motor entra sempre.</li>
      <li>Clique em <b>Analisar</b>. <i>Editar cortes</i> volta ao desenho mantendo as linhas.</li>
    </ol>
    <Tbl head={["Figura (1200 × 800 px)","Conteúdo"]} rows={[
      ["Mapas","(a) binarização sobre a foto; (b) potencial u em cores, com curvas de nível — juntas = encosta íngreme, espaçadas = platô; (c) corte u > τ e, com GT, o contorno anotado em ciano. As linhas de corte aparecem nos três painéis."],
      ["Perfil de corte (um por linha)","dois perfis de terreno ao longo da linha: a escuridão com o plano de corte de Otsu e o potencial u com τ e os demais níveis; acima do plano fica colorido. Faixa ciano = GT; faixa violeta = trecho escuro sem polo. Os rótulos em px indicam quanto cada borda anda entre o nível mais baixo e o mais alto."],
      ["Curva de corte","à esquerda, a área acima de cada nível t (curva hipsométrica, em log); à direita, com GT, a IoU em cada nível ou, sem GT, a densidade de pixels por nível — muitos pixels no nível do corte indicam borda instável."]]}/>
    <p>Cada figura traz uma faixa de <b>interpretação</b> escrita a partir dos números: quantas vezes cada curva cruza o corte, trechos escuros sem polo, deslocamento da borda entre os níveis (≤ 6 px = encosta íngreme), sensibilidade da área ao limiar e, com GT anotado, a IoU de cada conceito no total e ao longo de cada linha. As figuras saem no idioma ativo; a <b>folha com todas</b> reúne tudo num PNG. Os eixos de todos os gráficos terminam com um valor nas duas pontas.</p>
    <h3>Medidas de largura nos cortes</h3>
    <p>Em cada corte, as fronteiras do desplacamento são os pontos em que o potencial cruza τ, <b>interpolados entre pixels</b>. A distância entre duas fronteiras seguidas é a largura da região naquela linha. A medida vem com uma <b>faixa de incerteza</b>: a menor e a maior largura entre os níveis escolhidos (por exemplo 0,3; 0,5; 0,7). Faixa estreita indica encosta íngreme e medida firme; faixa larga indica platô, onde a borda depende do limiar.</p>
    <ul>
      <li>O perfil de cada corte traz a cota de cada região (R1, R2…) em px e, com calibração, em mm.</li>
      <li>A figura <b>Medidas</b> reúne a tabela de todos os cortes e um gráfico de ponto (largura em τ) e barra (faixa); o botão <b>CSV</b> exporta tudo, com as coordenadas das fronteiras.</li>
      <li>Região que toca a ponta do corte sai marcada com * (largura truncada): prolongue a linha.</li>
      <li>A conversão em mm usa o mm/px das configurações e só vale para foto de frente para a superfície.</li>
    </ul>
    <h3>Largura de fissura (modo Fissura)</h3>
    <p>Na barra da ferramenta, troque de <b>Corte</b> para <b>Fissura</b> e trace o <b>eixo ao longo da fissura</b> (pode traçar várias: F1, F2…). A cada 2 px um perfil perpendicular de ±20 px (campo <i>Perfil ±</i>) é analisado: o fundo é a mediana das pontas, o vale é o mínimo perto do eixo (o perfil acompanha a fissura quando ela se afasta da linha) e a largura é medida <b>a meia profundidade do vale (FWHM)</b>, interpolada entre amostras. Também é dada a <b>largura equivalente</b> (área do vale ÷ profundidade).</p>
    <Tbl head={["Saída","Conteúdo"]} rows={[
      ["Figura Largura de fissura","recorte da foto com as bordas encontradas em cada perfil, largura ao longo da fissura (mediana e faixa p10–p90, linha do limite de resolução) e perfil médio alinhado no vale"],
      ["CSV fissuras","uma linha por perfil: posição, validade, FWHM, largura equivalente, profundidade e mm"]]}/>
    <Note kind="warn">Uma fissura mais estreita que cerca de 3 px fica abaixo da resolução da foto: o borramento da óptica alarga o vale, e a FWHM passa a ser um <b>teto</b> (abertura real menor ou igual). A ferramenta avisa quando a mediana cai abaixo de 3 px. Em fissuras sintéticas de largura conhecida, o erro foi menor que 0,5 px a partir de 3 px e menor que 0,1 px a partir de 5 px; fissuras de 1 e 2 px saíram como cerca de 2,7–2,9 px. Para medir aberturas finas, aproxime a câmera até a fissura cobrir alguns pixels.</Note>
    <h3>Menor distância entre contornos (modo Distância)</h3>
    <p>Troque para <b>Distância</b> e clique em dois contornos: o primeiro fica verde, o segundo rosa (D1, D2…). Vale qualquer região do motor — desplacamento, armadura exposta, fissura, corrosão, eflorescência — clicando sobre ela ou a até 20 px. Quando o ponto pertence a duas classes, a armadura vem primeiro (fica dentro do desplacamento) e a fissura por último. A ferramenta encontra a menor distância entre os pixels de borda dos dois contornos (precisão de cerca de 1 px) e desenha o segmento; com perspectiva corrigida, a busca é feita no plano retificado. A figura <b>Distâncias</b> traz o mapa, a tabela e um zoom em cada segmento; a <b>CSV distâncias</b> exporta os pontos. Distância 0 indica contornos em contato.</p>
    <h3>Escala e correção de perspectiva (modo Escala)</h3>
    <p>Troque para <b>Escala</b>, clique os <b>4 cantos de um retângulo de medidas conhecidas</b> no plano da superfície — painel de forma, junta, placa ou régua de referência — em sentido horário a partir do canto superior esquerdo, e informe largura × altura em mm. Uma homografia leva cada ponto da imagem ao plano da superfície; todas as medidas (larguras dos cortes, fissuras e distâncias) passam a ser convertidas no plano retificado. A calibração fica guardada para a foto.</p>
    <ul>
      <li>A figura <b>Escala e perspectiva</b> mostra o retângulo marcado, a vista retificada (confira ângulos retos e proporção) e quanto a escala local varia dentro do retângulo — o erro que uma escala única cometeria.</li>
      <li>Sem os 4 pontos, vale o mm/px das configurações (foto de frente).</li>
      <li>A correção só vale para pontos no plano do retângulo: relevo e outras faces não são corrigidos.</li>
    </ul>
    <Note>Teste com a foto de referência vista em perspectiva (homografia conhecida, 600 × 900 mm): a distância entre os dois desplacamentos medida pela ferramenta foi 31,01 mm, contra 30,98 mm para os mesmos pontos no plano real (0,1 %). Sem correção, a escala única deu 34,88 mm. A diferença para os 26,65 mm da foto de frente vem do contorno detectado, não da perspectiva: as bordas saíram 3 a 5 px diferentes na imagem deformada.</Note>
    <h3>Exportação em SVG (texto editável)</h3>
    <p>Em todo lugar com gráfico há, ao lado do PNG, o botão <b>SVG</b>: figuras do Corte de nível e a folha com todas, figuras e painel 2×2 do Campo do walker, e cada etapa do motor (no visualizador ampliado). Títulos, rótulos, números dos eixos, legendas e interpretações saem como texto <b>editável</b> no Inkscape, Illustrator ou navegador; eixos, curvas, linhas de corte, rosa e barras de cor saem como vetores; só fotos e mapas de cor ficam embutidos como imagem. As figuras são as mesmas do PNG, desenhadas pela mesma rotina.</p>
    <h3>Filtros ao vivo (modo Live)</h3>
    <p>No Live, escolha o motor <b>CDM-4 · Filtros (etapas)</b> nos ajustes. As etapas do fluxo por evidência viram filtros sobre o vídeo, trocados com um toque na barra que aparece abaixo do topo: <b>rugosidade normalizada</b>, <b>diversidade de Ataky</b>, <b>polos do walker</b>, <b>potencial do walker</b> e <b>contorno do desplacamento</b> (com a contagem de regiões). Cada filtro tem a legenda de intensidade com o limiar marcado; o concreto típico da cena fica transparente.</p>
    <Tbl head={["Ajuste","Padrão","Efeito"]} rows={[
      ["Resolução do filtro","320 px","lado maior do quadro analisado; 240–480 px. Em 320 px, cerca de 2 a 5 atualizações por segundo, conforme o aparelho; em 480 px, cerca de 1 por segundo."],
      ["Limiar τ do walker","0,5","nível de corte do potencial e do contorno."],
      ["Partir do potencial do quadro anterior","ligado","reaproveita o potencial entre quadros parecidos; sem ele, cada quadro parte de uma solução em meia resolução (grossa → fina)."],
      ["Estabilizar máscaras","ligado","média temporal da camada do filtro, para reduzir o cintilar."]]}/>
    <p>O vídeo continua fluido; é a camada do filtro que se atualiza na taxa da análise. As equações e os polos são os do motor; só as janelas espaciais são ajustadas ao tamanho do quadro (rugosidade ≥ 5 px, Shannon ≥ 9 px). Na foto de referência reduzida a 320 px, o contorno ao vivo dá IoU de 73,6 % contra o GT. As capturas de foto e vídeo levam a legenda do filtro gravada no quadro.</p>
    <Note>Na foto de referência com GT: binarização IoU 7,3 % (no melhor limiar possível, 13,4 %); corte do potencial IoU 69,9 %, e entre 65 e 74 % para qualquer nível de 0,3 a 0,7. A borda do walker anda 5 px em média entre u = 0,3 e 0,5. A binarização é o caso mais simples (Otsu global); uma binarização adaptativa melhora a IoU, mas continua julgando cada pixel sem saber a que ele está ligado.</Note>
  </>},

  {id:"results",title:"Regiões, caixas e resultados",kw:"consolidação caixa rótulo resultado achados lista medidas",body:<>
    <p>Cada componente conexo vira um <b>achado</b> com identificador (por exemplo, <code>F1</code> fissura, <code>D2</code> desplacamento, <code>A1</code> armadura, <code>C3</code> corrosão, <code>E1</code> eflorescência), caixa delimitadora, área, centroide e — para fissuras — comprimento e largura média.</p>
    <h3>Consolidação</h3>
    <Eq n={e()}>{"A_{min,cls} = \\max\\left(A_{min},\\; 0.0005 \\cdot A_{img},\\; 0.03 \\cdot A_{maior,cls}\\right)"}</Eq>
    <p>Achados abaixo desse limite são descartados como irrelevantes; uma caixa com ≥ 80 % de sua área dentro de outra maior da mesma classe, e com o centro dentro do contorno dela, é absorvida (as áreas são somadas), evitando caixas repetidas. Os polígonos seguem o contorno real do componente (rastreamento de Moore simplificado por RDP), não o fecho convexo. Com o filtro de contexto ativo, as regiões de área são recortadas pela máscara de cena antes da vetorização, de modo que manchas ligadas apenas pelo fundo irrelevante ficam separadas.</p>
    <FigConsolidation n={f()}/>
    <h3>Filtro de contexto IA</h3>
    <p>Opcional (Configurações › CDM-1). Um SegFormer-B0 treinado no ADE20K (150 classes de cena: céu, árvore, grama, pessoa, animal, água, carro, placa, parede, ponte…) roda no navegador. É <b>segmentação semântica</b>: cada pixel recebe uma classe — não há detecção de objetos com caixas, nem instâncias separadas, nem segmentação panóptica. Os nomes reais dos objetos aparecem no canvas e em <i>Resultados › Objetos da cena</i>. O CDM continua rodando na imagem inteira; <b>depois</b>, cada componente <M>{"K"}</M> é descartado se a fração de sua área sobre regiões irrelevantes <M>{"X"}</M> (céu, vegetação, solo, água, veículos, pessoas, placas, postes; no modo estrito, tudo que não for estrutura) atingir o limiar <M>{"\\tau"}</M> (padrão 0,6):</p>
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

  {id:"gt",title:"Anotação Ground Truth (few-shot)",kw:"anotação ground truth few-shot multiescala coco máscara recorte avaliar iou dice cldice",body:<>
    <p>A ferramenta de anotação (ícone de caneta na barra lateral ou <i>Análise › Anotação Ground Truth</i>) cria o Ground Truth de poucas imagens bem anotadas, usado para medir o CDM (inclusive dentro do <i>Campo do walker</i> do CDM-4, que usa a anotação de desplacamento da sessão) e treinar pesos próprios.</p>
    <h3>Três níveis de escala</h3>
    <Tbl head={["Nível","Zoom","Classes","Ferramentas"]} rows={[
      ["Cena","1×","estrutura · irrelevante","polígono, Bézier, B-spline, pincel"],
      ["Região","2–4×","desplacamento, armadura, corrosão, eflorescência","polígono, Bézier, B-spline, espiral, pincel"],
      ["Detalhe","≥ 8×","fissura","linha central, Bézier, B-spline, espiral, pincel"]]}/>
    <h3>Curvas (como no Inkscape)</h3>
    <ul>
      <li><b>Bézier</b>: clique cria nó de canto; clique e arraste cria nó suave com alças. Cada trecho é uma cúbica <M>{"B(t) = (1-t)^3 P_0 + 3(1-t)^2 t\\, P_1 + 3(1-t) t^2 P_2 + t^3 P_3"}</M>.</li>
      <li><b>B-spline</b>: pontos de controle; a curva cúbica uniforme passa suave perto deles — ideal para bordas de desplacamento.</li>
      <li><b>Espiral</b>: centro e raio por arraste; <M>{"r(t) = R\\, t^{d}"}</M>, <M>{"\\theta(t) = \\theta_0 - 2\\pi n (1 - t)"}</M>, com voltas <M>{"n"}</M> e divergência <M>{"d"}</M>.</li>
      <li>Com <b>Selecionar</b>, arraste nós, alças (Alt = alça independente), pontos de controle e o centro/raio da espiral. Classes de área geram caminho fechado; fissuras, caminho aberto com largura.</li>
    </ul>
    <p>Os vetores são guardados nas coordenadas da imagem, então um polígono feito a 2× e uma fissura traçada a 16× ficam alinhados. O pincel tem tamanho fixo na tela: com mais zoom o traço fica mais fino na imagem, permitindo anotar fissuras de 1–2 px. Cada anotação registra o zoom em que foi feita.</p>
    <h3>Few-shot com sugestão do CDM</h3>
    <p><i>Sugerir do CDM</i> converte os achados da última análise em anotações tracejadas; aceite, rejeite ou apague cada uma (ferramenta Selecionar) ou todas de uma vez. Só anotações manuais e sugestões aceitas entram nas máscaras e nas métricas.</p>
    <h3>Avaliar CDM</h3>
    <Eq n={e()}>{"IoU = \\frac{TP}{TP + FP + FN}, \\quad Dice = \\frac{2TP}{2TP + FP + FN}, \\quad clDice = \\frac{2\\, T_{prec}\\, T_{sens}}{T_{prec} + T_{sens}}"}</Eq>
    <p>com <M>{"T_{prec} = |S_{pred} \\cap V_{GT}| / |S_{pred}|"}</M> e <M>{"T_{sens} = |S_{GT} \\cap V_{pred}| / |S_{GT}|"}</M>, sendo <M>{"S"}</M> o esqueleto e <M>{"V"}</M> a máscara: o clDice mede se a continuidade das fissuras foi preservada.</p>
    <h3>Exportação (ZIP)</h3>
    <ul>
      <li><code>annotations/*_coco.json</code> — COCO: polígonos; traços e fissuras em RLE, com a polilinha e a largura em <code>shm</code>.</li>
      <li><code>masks/*_label.png</code> — índice da classe por pixel (1 estrutura … 7 fissura), na resolução original.</li>
      <li><code>tiles/s1, s2, s4</code> — recortes de até 512 px da imagem inteira, da grade 2×2 e da 4×4, para treino multiescala.</li>
    </ul>
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
