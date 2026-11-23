# CDM-4 — motor próprio de imagem 2D (`cdm_4`, 4.0.0)

**Status:** dev. Motor separado no catálogo, ao lado do CDM-1 (`cdm_1`) e do CDM-3 espacial (`cdm_3`). Roda inteiramente no navegador (`frontend/src/cdm4Core.js`, Web Worker `cdm4Worker.js`). Ainda não tem gêmeo Python no backend.


O núcleo foi copiado do CDM 2.11 (`cdmBrowser.js`). O CDM-1, o CDM-3 espacial, o `contextFilter.js` e o `cdm_v285.py` não foram alterados. Com todas as etapas novas desligadas, o CDM-4 reproduz exatamente os registros do CDM-1; `scripts/check-cdm4-core.mjs` verifica isso no CI. A segmentação continua determinística e sem pesos treinados. A IA de contexto (SegFormer-B0 ADE20K) só exclui cena.

| Ordem | Etapa | Módulo | Opção (`false` desliga) |
|---|---|---|---|
| 1 | Morfologia CDM 2.11 (5 famílias, separação hierárquica) | `cdm4Core.js` | — |
| 2 | IA de contexto corrigida: F1, terreno/água cercado pela estrutura vira neutro; F2, erosão de 0,5 célula; F4, céu superexposto (RGB ≥ 245 ligado à borda); F5, terreno dominante (terra/areia/água > 50 % do quadro, típico de close-up de concreto rugoso) vira neutro | `cdm4Scene.js` | `cdm4_context_f1`, `cdm4_context_erode_cells`, `cdm4_context_sky`, `cdm4_context_f5` |
| 3 | Canal de diversidade (Ataky 2022: Shannon, Gini-Simpson), referência global | `cdm4Biodiversity.js` | `cdm4_diversity` |
| 4 | Refino de borda por biodiversidade (`refine` no desplacamento, `gate` na eflorescência; referência de área guardada antes do gate) | `cdm4Biodiversity.js` | `cdm4_biodiversity` |
| 5 | Random walker de Grady (β = 30, escala 1/2, p > 0,3): polo de dano = núcleo do desplacamento morfológico; polo saudável = longe dos candidatos ou homogêneo (Shannon z < −0,5) | `cdm4RandomWalker.js` | `cdm4_random_walker`, `cdm4_rw_threshold`, `cdm4_rw_beta`, `cdm4_rw_max_grow_px` |
| 6 | Armadura exposta por abertura linear (black-hat k = 21, L = 61 px, 12 orientações, porta de escuridão no percentil 15, histerese 30/80, alongamento ≥ 3) | `cdm4Rebar.js` | `cdm4_linear_rebar`, `cdm4_rebar_percentile` |
| 7 | Recorte final pela exclusão de contexto, vetorização e classificação normativa | `cdm4Core.js` | — |
| 8 | Pigmentos por Beer–Lambert (neutro, ferrugem, biológico; I₀ = concreto saudável da foto), **apenas diagnóstico** em `record.pigments` e `metrics.pigments` | `cdm4Pigments.js` | `cdm4_pigments` |

**Validação** (`frontend/src/cdm4*.js` em Node, ONNX de contexto real, mesmas 20 fotos de campo; ground truth do autor apenas na foto 24):

| Medida | CDM 2.11 (CDM-1) | Ordem integrada (biodiversidade) | CDM-4 4.0.0 |
|---|---|---|---|
| Foto 24 · IoU desplacamento | 26,6 % | 63,7 % | **70,6 %** (precisão 84,6 %, revocação 81,0 %) |
| Foto 24 · IoU armadura exposta | 13,2 % | — | **53,6 %** |
| 20 fotos · área de desplacamento em fotos com o dano | 905 mil px | 1 236 mil px | 1 557 mil px |
| 20 fotos · área de desplacamento em fotos sem o dano | 320 mil px | 393 mil px | 611 mil px |

- O random walker reproduz o `skimage.segmentation.random_walker`: correlação de 0,998 com o mapa de probabilidade do protótipo Python.
- O detector linear de armadura é idêntico pixel a pixel ao protótipo Python.
- **Limitação:** o random walker expande qualquer semente, inclusive as falsas. Nas fotos sem desplacamento, a área falsa cresce. A cura é calibrar com mais ground truth: 10–20 fotos anotadas, metade para calibrar e metade para testar.
- **Fissuras e eflorescência:** não mudam em relação ao CDM 2.11 (0/7 e 0/4 por localização nas 20 fotos).
- **Tempo:** cerca de 15 s por foto de 1600 px no navegador (Web Worker).

- **Fotos pequenas (< 1000 px):** o random walker usa escala 1 e distâncias dos polos proporcionais ao tamanho; fotos ≥ 1000 px mantêm a calibração validada (resultados das 20 fotos inalterados).

## Fluxo por evidência (experimental, `cdm4_flow = "evidence"`)

Ordem: normalização (referência = concreto claro do domínio) → contexto como domínio (F1/F4/F5) → evidências (rugosidade local, diversidade de Shannon, escuridão contra o fundo local) → polos (dano: rugosidade z ≥ 3, diversidade z ≥ 1 e núcleo espesso 9×9 na escala do walker; saudável: liso e homogêneo) → random walker (p > 0,5) → juiz de biodiversidade por componente → separação de famílias → armadura linear → recorte final. A morfologia não decide o desplacamento. Corrosão e eflorescência continuam nas regras de cor, e as fissuras no black-hat + esqueleto. Etapas próprias: rugosidade e diversidade com legenda, polos, potencial e juiz.

| Medida | Fluxo padrão | Fluxo por evidência |
|---|---|---|
| Foto 24 (PIL) · IoU desplacamento | 70,6 % | 73,0 % |
| Foto 24 (decodificação do Chrome) · IoU | 64,2 % | 68,4 % |
| Foto 24 · mancha falsa à direita | 11 822 px | 4 231 px (não cresce) |
| 20 fotos · área em fotos com dano | 1 557 mil px | 1 377 mil px |
| 20 fotos · área em fotos sem dano | 611 mil px | 550 mil px |
| 20 fotos · registros falsos de desplacamento | 40 | 19 |
| Close-up (inspecao_atual) | 3 desplacamentos | 3 desplacamentos |

Ganhos: contorno melhor no único GT, metade dos registros falsos, sem crescimento a partir de semente lisa, sem invadir alga na foto 27. Perdas: cobre menos o desplacamento largo da foto 81 e marca a borda de laje da foto 52. Continua experimental até haver mais GT.

## Afinamento automático do contorno (opção `cdm4_contour_refine`, desligada por padrão)

Para cada região do random walker, o limiar do potencial é ajustado por subida de encosta em passos decimais (0,08 → 0,04 → … → 0,005), dentro de ±0,1 do limiar inicial. O critério é o contraste de Fisher entre a faixa de 2 px logo dentro do contorno e a faixa logo fora, em luminância e rugosidade normalizadas. O loop para quando a distância simétrica média entre o contorno atual e o anterior fica abaixo de 0,25 px. Cada região registra o limiar final (3 casas), os passos e o último deslocamento. Há uma etapa própria, com o contorno antes (claro) e depois (laranja).

Medida no GT da foto 24, com o pipeline completo e a decodificação do Chrome:

| Fluxo | Sem afinamento | Com afinamento |
|---|---|---|
| Padrão | 64,2 % | 66,4 % |
| Por evidência | 68,4 % | 70,1 % |

Também foram testados o alinhamento ao gradiente ("edge") e o Chan–Vese local ("band"). Sem o limite de ±0,1, os três critérios encolhem o desplacamento até o núcleo, porque a textura do agregado tem bordas internas fortes.

## Ferramenta "Campo do walker"

O botão de mira na barra de ferramentas do canvas fica ativo depois de uma análise do CDM-4. Arrasta-se um quadrado 1:1 sobre a imagem, e dentro dele o random walker é resolvido de novo em resolução cheia. Os polos são os do motor, e a borda do quadrado fica presa ao lado que o motor decidiu. A ferramenta gera quatro figuras de 640 × 640 px, com a banda e a legenda padronizadas e no idioma ativo:

1. malha de setas −∇u, com cerca de 20 × 20 setas e legenda log₁₀ |∇u|; o contorno do motor aparece em ciano tracejado e o de resolução cheia em branco;
2. rosa do desvio angular em relação à direção "saindo do polo de dano", com R e variância circular;
3. dispersão local 1 − R, numa janela 9 × 9;
4. tabela de coerência por região: área no motor, área em resolução cheia, R da faixa da fronteira, |∇u| mediano e fração de platô (halo sem evidência).

Cada figura pode ser baixada em PNG, além de um painel 2 × 2 com as quatro. Em análises reabertas do histórico, o potencial é recalculado. No GT da foto 24, em quatro quadrados de 330 px ao longo do desplacamento, o walker em resolução cheia deu IoU de 65,4 → 70,2, 69,1 → 70,6, 74,3 → 74,3 e 71,2 → 75,8 %.

## Walker em resolução cheia na fronteira (`cdm4_walker_fullres`, experimental, desligado por padrão)

Para cada região de desplacamento (≥ 30 px), o walker é refeito pixel a pixel numa caixa com 24 px de margem,
com os mesmos polos do motor (potencial global ≥ 0,999 → dano, ≤ 0,001 → saudável) e a borda da caixa presa
ao lado decidido pelo motor. A decisão local (P > limiar) substitui a do motor dentro da caixa; exposição e
eflorescência continuam vetadas. Quando ligado, dispensa o afinamento por limiar. Aparece como etapa própria.

Foto 24 (GT): fluxo por evidência 68,4 → 70,7 de IoU (+0,7 s); fluxo padrão 64,2 → 62,8 — recomendado com o
fluxo por evidência, cujos polos já vêm limpos.

### IoU no Campo do walker

A figura 4 (tabela de coerência) mostra a IoU de cada contorno dentro da seleção:
- **com GT anotado na sessão** (classe Desplacamento): IoU, precisão e revocação do motor e da resolução cheia,
  e o ganho em pontos percentuais;
- **sem GT**: IoU de concordância motor × resolução cheia e Δ de área — mede o quanto os contornos divergem,
  não a acurácia.

Clicar numa figura abre a ampliação (← → navegam, Esc fecha). A ferramenta abre pela barra lateral, pelo menu Análise da barra superior ou pelo menu de contexto.

### Máscara do walker como fronteira (fluxo por evidência)

No fluxo por evidência, a máscara do walker (etapa do potencial, já com resolução cheia ou afinamento,
quando ligados) é a verdade de fronteira: a armadura da morfologia CDM 2.11 é recortada a ela antes do juiz
de biodiversidade, e o desplacamento final nunca sai dela (o juiz só remove). Antes, o juiz anexava ao
desplacamento toda a "armadura" da morfologia, e falsos núcleos que o walker não confirmou voltavam como
regiões pequenas (na foto 24, três regiões, a maior com 4.231 px²). Foto 24: IoU 68,4 → 70,2;
com resolução cheia 70,7 → 72,9. Registro: `refinement.walker_bound`.

## Corte de nível: binarização × potencial do walker (ferramenta de análise)

Ícone de tesoura (barra lateral), *Análise › Corte de nível (CDM-4)* ou menu de contexto. O usuário traça
n linhas de corte (A, B, C…) e escolhe os níveis do walker (padrão 0,3; 0,5; o limiar do motor entra sempre).
Saem, todas com 1200 × 800 px e faixa de interpretação gerada dos números:

1. **Mapas** — binarização (escuridão normalizada > Otsu), potencial u com curvas de nível, corte u > τ (+ GT).
2. **Perfil de corte** (um por linha) — perfis de terreno da escuridão e de u, com os planos de corte, faixas de GT,
   trechos escuros sem polo (escuridão > Otsu e u < 0,05 por ≥ 6 px) e o deslocamento da borda entre níveis.
3. **Curva de corte** — área acima de cada nível (hipsométrica, log) e IoU × nível (com GT) ou densidade de
   pixels por nível (sem GT).

Núcleo em `cdm4CutAnalysis.js` (funções puras: `cutBase`, `profile`, `interpret*`; testado em
`check-cdm4-core`), figuras em `cdm4CutFigures.js`, interface em `CutLevelTool.jsx`.
Foto 24 (GT): binarização IoU 7,3 % (máx. 13,4 % em qualquer limiar); potencial 69,9 % (65–74 % para t ∈ [0,3; 0,7]);
borda do walker anda 5,0 px em média entre u = 0,3 e 0,5.

### Cortes com passo controlado e exportação SVG

- **Ctrl (⌘) ao traçar um corte**: ângulo em múltiplos de 15° e comprimento em passos fixos (campo *Passo (Ctrl)*,
  padrão 20 px), com leitura de comprimento e ângulo junto ao cursor — cortes do mesmo tamanho ao longo do walker.
  Shift continua travando na horizontal/vertical. Lógica em `snapCut` (`CutLevelTool.jsx`).
- **Eixos**: todos os gráficos terminam com valor nas duas pontas (`axisTicks`, faixas log em décadas inteiras;
  barras de intensidade das etapas sempre com mínimo e máximo).
- **SVG com texto editável** em todos os gráficos (Corte de nível, Campo do walker, etapas): `svgCanvas.js` implementa a
  API do Canvas 2D usada pelas figuras e gera `<text>`, `<path>`, `<linearGradient>`, `<clipPath>`; rasters (fotos e
  mapas de cor) entram como `<image>`. A mesma rotina desenha o PNG e o SVG. Textos com largura máxima levam
  `textLength` (layout estável com fonte substituta; suportado por navegadores e Inkscape ≥ 1.0).

## Filtros ao vivo (modo Live)

Motor Live `cdm_4_filters` (“CDM-4 · Filtros (etapas)”, ligado ao `cdm_4` do catálogo): as etapas do fluxo por evidência
como filtros sobre o vídeo — rugosidade, diversidade, polos, potencial do walker, contorno (contagem de regiões).
Núcleo em `cdm4Live.js` (`runCdm4FilterLive`, `liveWalker`, `liveEvidenceOpts`), roda no worker do Live.

- Janelas escaladas ao quadro com piso: rugosidade ≥ 5 px, Shannon ≥ 9 px; núcleo do polo ∝ lado/800.
  Foto 24 reduzida (média em blocos) a 320 px: IoU 73,6 % (escalado puro 70,9 %; janelas do motor 70,1 %).
- Walker grossa → fina: solução em meia resolução ampliada como ponto de partida (`solveWalker` aceita `x0`; sem `x0`
  o comportamento do motor é idêntico); entre quadros, o potencial anterior é reaproveitado (opção).
- Tempo por quadro (CPU, worker): 240 px ≈ 0,2–0,26 s; 320 px ≈ 0,3–0,4 s (até ~0,7 s em máquina lenta); 480 px ≈ 0,8–1 s.
- Próximo passo se a taxa não bastar: walker em WebGL.

### Medidas de largura nos cortes

`profileNotes` devolve `regions`: fronteiras em u = τ interpoladas entre pixels (`sL`, `sR`), largura e faixa
`[wMin, wMax]` entre os níveis escolhidos; em cada borda, a busca de um nível vai para fora se o pixel da borda já está
acima do nível e para dentro se está abaixo. Cotas no perfil, figura **Medidas** (tabela + ponto/barra) e CSV
(`measureRows`, `measuresCsv`). mm via `metrics.mm_per_px` (pixels da imagem processada). Foto 24, níveis 0,3/0,5/0,7,
0,5 mm/px: corte A 144,4 px (126,4–155,1) = 72,2 mm; corte diagonal C 196,6 px (193,6–198,8).

### Largura de fissura por perfil perpendicular (modo Fissura)

`cdm4CrackWidth.js`: eixo traçado pelo usuário; perfis perpendiculares a cada 2 px, ±R px (padrão 20), média de 3 linhas,
amostragem 0,25 px; fundo = mediana das pontas (|d| ≥ 0,6R), vale = mínimo em |d| ≤ 0,6R, profundidade mínima
max(8 níveis, 3·MAD do fundo); FWHM interpolada; largura equivalente = área do vale ÷ profundidade.
Fissuras sintéticas (PSF σ = 1 px): 3 px → 3,44; 5 → 5,05; 8 → 7,99; 12 → 11,97; 1 e 2 px → 2,65 e 2,93
(abaixo da resolução, sinalizado quando a mediana < 3 px: o valor vira teto). Fissura real da foto 24 (546,1447)→(549,1540):
mediana ≈ 2,7–2,9 px, sinalizada.
