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
