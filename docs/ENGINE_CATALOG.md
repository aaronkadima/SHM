# Catálogo de motores

A plataforma usa um contrato de saída comum para que arquiteturas heterogêneas possam ser visualizadas juntas. O catálogo é deliberadamente maior que a lista inicial e cobre quatro grupos relevantes em inspeção visual SHM.

| Grupo | Motores integrados | Saída principal |
|---|---|---|
| Detectores de alta velocidade | YOLO11, YOLOv8, RT-DETR | caixas/classes |
| Open-vocabulary / foundation | YOLO-World, Grounding DINO, FastSAM, SAM 2, Grounded SAM 2 | caixas e/ou máscaras |
| Segmentação supervisionada | Mask R-CNN, U-Net, U-Net++, DeepLabV3+, PSPNet, FPN, PAN, MAnet, LinkNet, SegNet | máscaras |
| Transformers / high-resolution | SegFormer, Mask2Former, HRNet+OCR, UPerNet+Swin, CrackFormer, CrackFormer-II, DINOv2 segmentation head | máscaras |
| Portabilidade / baseline | Custom ONNX, OpenCV morphology | máscaras/caixas normalizadas |

## Estado de integração

`ready` significa que a dependência e os pesos necessários estão acessíveis no ambiente. `requires_weights` significa que o adaptador está implementado, mas falta um checkpoint. `missing_dependency` indica que o framework opcional não está instalado.

Modelos Foundation generalistas podem operar sem um checkpoint SHM específico, mas o campo `pathology_ready` permanece falso até existir treinamento/fine-tuning e validação no domínio alvo.

## Taxonomia comum

A camada de normalização usa: crack, spalling, delamination, corrosion, exposed_rebar, efflorescence, moisture, honeycombing, scaling, abrasion, joint_damage, bearing_damage e other.

Para estudos quantitativos, mantenha um arquivo de mapeamento auditável entre a taxonomia original do dataset e essa taxonomia comum.
