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
