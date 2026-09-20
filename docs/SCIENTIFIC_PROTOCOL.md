# Protocolo científico de comparação

A comparação visual serve para inspeção exploratória. Uma comparação de desempenho entre motores exige um protocolo separado e reprodutível.

## 1. Dados

Use um conjunto anotado independente do treinamento, com divisão fixa por estrutura/obra — e não apenas por imagem — para reduzir vazamento de cenas quase idênticas. Registre câmera, distância, iluminação, resolução, tipo de elemento, material e condição ambiental quando disponíveis.

## 2. Taxonomia

Congele a taxonomia antes do benchmark. Classes inexistentes em um modelo devem ser marcadas como não suportadas; não devem ser silenciosamente fundidas a `other`.

## 3. Pré-processamento

Registre resolução efetiva, tile/overlap, normalização, letterboxing, threshold e NMS de cada motor. Para fissuras finas, informe a resolução física quando houver escala (mm/pixel).

## 4. Métricas

- Detecção: precision, recall, F1, AP50 e mAP50:95 por classe.
- Segmentação: IoU/Jaccard, Dice/F1 de pixel, precision/recall de pixel.
- Fissuras: além de IoU/Dice, relatar erro de comprimento e largura quando a calibração espacial permitir.
- Operação: latência mediana e p95, VRAM/RAM, tamanho do modelo e resolução usada.

Não compare somente `confidence`, pois as pontuações não são calibradas de modo equivalente entre arquiteturas.

## 5. Repetibilidade

Fixe versões de código/dependências, seeds, checkpoint SHA256, hardware e commit Git. Exporte resultados por imagem para CSV/JSON e preserve máscaras em formato lossless.

## 6. Separação entre screening e decisão de engenharia

Open-vocabulary e modelos foundation podem acelerar triagem, mas a decisão de condição/severidade deve usar um modelo validado para a taxonomia, a população de estruturas e o protocolo de inspeção correspondente.
