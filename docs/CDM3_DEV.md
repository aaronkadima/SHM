# CDM-3 — integração DEV

**Status:** experimental, branch `dev`. Não promover para `main` antes de concluir os gates de validação abaixo.

## Arquitetura implementada

### Estágio A — entorno
- Prior local a partir das classes ASPRS do próprio LAS/LAZ.
- Dynamic World, Sentinel-2, Sentinel-1 e Sen1Floods11 permanecem fontes de contexto geoespacial quando houver georreferenciamento confiável.
- Satélite não é usado como detector de fissuras ou de patologias milimétricas.

### Estágio B — componente estrutural
- Implementado: resolução geométrica ponto 3D -> elemento IFC mais próximo.
- O `host_element.ifc_global_id` é gravado no registro da patologia quando a geometria 3D permite associação confiável.
- Evolução prevista: classificador visual Open Images -> SemanticBridge como prior semântico; a identidade final do elemento continua sendo resolvida geometricamente.

### Estágio C — patologia
- Vocabulário: fissuras, desplacamento, armadura exposta, corrosão e eflorescência.
- Pipeline de treino: SegFormer B0 -> DACL10K remapeado -> fine-tuning com rótulos CDM curados.
- Sem `SHM_CDM3_CHECKPOINT`, o motor usa explicitamente o CDM-1 como bootstrap morfológico. O fallback é marcado em `metrics.runtime_mode=morphology_bootstrap`; a plataforma não apresenta esse resultado como inferência IA.
- Com checkpoint configurado, `runtime_mode=segformer_stage_c`.

## Importação espacial no canvas DEV

O frontend de desenvolvimento reconhece automaticamente os formatos espaciais próprios do CDM-3:

- `.las`: leitura binária LAS não comprimida, preservando escala, offset, formato de ponto, bounds e classes amostradas; a prévia é uma nuvem de pontos Three.js.
- `.xyz`: leitura de coordenadas X Y Z separadas por espaço, vírgula ou ponto e vírgula; a prévia é uma nuvem de pontos.
- `.ifc`: leitura STEP para identificação de schema/entidades e extração de coordenadas cartesianas para prévia espacial. A resolução geométrica/semântica final continua no backend com IfcOpenShell.

Ao importar qualquer um desses três formatos, a UI seleciona automaticamente somente o CDM-3, identifica o arquivo como **CDM-3 espacial**, habilita **Analisar** e reporta formato, pontos amostrados, bounds e metadados IFC no painel de resultados.

Limitações atuais: `.laz` ainda não é aceito pelo parser browser; a prévia IFC não substitui a tesselação geométrica completa do IfcOpenShell; e a importação espacial não deve ser interpretada como um checkpoint de detecção 3D já treinado.

## LAS <-> IFC

O módulo de alinhamento implementa ICP rígido como refinamento. ICP ponto-a-ponto não deve ser usado como única fonte de pose quando o alvo é dominado por superfícies planas (por exemplo, tabuleiro/laje), pois existe degenerescência geométrica. Para inspeções reais, usar GCP/RTK-GNSS ou uma inicialização equivalente e, quando possível, incluir feições não planares (pilares, vigas, guarda-corpos, juntas) antes do refinamento ICP.

## IFC + SVG

A exportação materializa cada patologia como:
1. `IfcAnnotation`;
2. vínculo ao elemento hospedeiro por `IfcRelAssignsToProduct`;
3. `Pset_CDM_Pathology`;
4. SVG vetorial com metadados de coordenadas, associado ao IFC como documento.

Endpoints DEV:
- `GET /cdm3/status`
- `POST /cdm3/las/summary`
- `POST /cdm3/ifc/resolve`
- `POST /cdm3/ifc/export`

Dependências espaciais opcionais:
```bash
pip install -r backend/requirements-cdm3.txt
```

## Gates antes de liberar para main

- [ ] Backend importa e inicia sem dependências opcionais instaladas.
- [ ] `GET /cdm3/status` responde e diferencia checkpoint ausente/configurado.
- [ ] CDM-3 aparece no catálogo DEV.
- [ ] Bootstrap morfológico produz camadas e registros sem alegar IA.
- [ ] Checkpoint Stage-C real passa validação por classe (IoU/Dice/Recall e conjunto externo).
- [ ] LAS real: resumo, classes ASPRS e contexto ambiental validados.
- [ ] LAS↔IFC: alinhamento validado com GCP/pose inicial e geometria não planar.
- [ ] IFC real: `by_guid`, unidade de comprimento e resolução do hospedeiro conferidos.
- [ ] Visualizador IFC confirma `IfcAnnotation` no elemento correto e SVG associado.
- [ ] Frontend DEV compila e `/SHM/dev/` carrega o catálogo atualizado.
- [ ] Testes/CI do branch `dev` passam.
- [ ] Somente após esses gates: PR/merge de `dev` para `main`.

### Textura/cor da nuvem de pontos

O visualizador DEV preserva os atributos visuais da nuvem em vez de reduzir o ativo a coordenadas XYZ:

- **LAS com RGB** (formatos de ponto 2, 3, 5, 7, 8 e 10): renderização por cor RGB de cada ponto.
- **LAS sem RGB**: modos alternativos por intensidade, classificação ASPRS e elevação Z.
- **XYZ**: aceita `X Y Z R G B` quando as três colunas de cor estão presentes; `X Y Z` continua válido para geometria.
- O canvas permite alternar entre os canais disponíveis: **RGB / Intensidade / Classificação / Elevação Z**.

Regra de segmentação CDM-3: geometria, intensidade e classes são adequadas para segmentação de componentes, terreno, tabuleiro, água/vegetação e priors espaciais. Elas **não substituem informação fotométrica** para detecção visual fina de fissuras, corrosão, manchas, eflorescência ou desplacamento superficial. Para estas manifestações, o pipeline deve usar RGB por ponto ou imagens RGB/IRT calibradas e registradas na mesma referência espacial da nuvem/IFC. A interface sinaliza explicitamente quando o ativo não possui RGB, evitando atribuir confiança visual a uma nuvem sem textura.

### Registro de imagem RGB sobre LAS/XYZ/IFC

Quando a nuvem não possui RGB interno, o DEV permite anexar uma **Imagem RGB** auxiliar sem substituir o ativo espacial. O vínculo segue duas fases:

1. **Fonte fotométrica anexada** — a imagem fica associada ao LAS/XYZ/IFC e aparece em Camadas e no canvas como `RGB externo`.
2. **Registro geométrico 2D→3D** — a pose da câmera é resolvida por correspondências pixel↔coordenada 3D usando PnP/RANSAC no endpoint `/cdm3/registration/pnp`. A projeção de pontos 3D de volta para a imagem usa `/cdm3/registration/project`.

O registro exige pelo menos 6 correspondências 2D–3D. Intrínsecos de câmera (`fx`, `fy`, `cx`, `cy`) podem ser fornecidos. Na ausência deles, o backend aceita uma aproximação pinhole apenas para inicialização/preview e retorna `metric_projection_valid=false`; esse resultado não deve ser usado para quantificação métrica de patologias. A projeção final de máscaras para a nuvem/IFC só deve ser habilitada após uma pose aceita e, para uso métrico, calibração intrínseca válida.

Ao trocar o ativo espacial principal, a imagem RGB auxiliar é removida automaticamente para impedir associação acidental entre arquivos de campanhas ou modelos diferentes.

