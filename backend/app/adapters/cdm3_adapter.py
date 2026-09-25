"""CDM-3 dev adapter.

Until a trained CDM-3 Stage-C checkpoint is configured, the engine deliberately
uses CDM-1 morphology as a transparent bootstrap instead of pretending AI
weights exist. Spatial LAS/IFC capabilities are exposed separately under
/cdm3/* endpoints.
"""
from __future__ import annotations

import os
from pathlib import Path

from PIL import Image

from .base import AdapterMeta, EngineAdapter, png_b64
from .cdm_adapter import CDM1Adapter
from ..schemas import Detection, EngineResult
from ..cdm3.stage_c import build_records, predict_class_map, render_overlay


class CDM3Adapter(EngineAdapter):
    meta = AdapterMeta(
        "cdm_3",
        "CDM-3",
        "Concrete Damage Morphology / Spatial AI",
        "semantic_segmentation",
        (
            "Motor espacial experimental para patologias de concreto: "
            "segmentação multiclasse, contexto LAS, vínculo geométrico IFC "
            "e exportação SVG/IfcAnnotation."
        ),
        requires_weights=False,
        recommended=False,
        domain_mode="shm_checkpoint",
    )

    def _checkpoint(self) -> Path | None:
        value = os.getenv("SHM_CDM3_CHECKPOINT", "").strip()
        if not value:
            return None
        path = Path(value).expanduser()
        return path if path.exists() else None

    def availability(self):
        checkpoint = self._checkpoint()
        if checkpoint is not None:
            return True, f"CDM-3 Stage-C checkpoint: {checkpoint}"
        return True, (
            "DEV bootstrap ativo: Stage-C ainda sem checkpoint treinado; "
            "execução 2D usa morfologia CDM-1 como fallback rastreável."
        )

    def _bootstrap(self, image: Image.Image) -> EngineResult:
        base = CDM1Adapter().predict(image)
        metrics = dict(base.metrics or {})
        metrics.update({
            "implementation": "CDM-3 3.0.0-dev",
            "runtime_mode": "morphology_bootstrap",
            "experimental": True,
            "stage_c_ai_ready": False,
            "stage_c_checkpoint": None,
            "spatial_pipeline": {
                "las_summary": "/cdm3/las/summary",
                "ifc_resolve": "/cdm3/ifc/resolve",
                "ifc_export": "/cdm3/ifc/export",
            },
            "training_plan": {
                "pathology": ["DACL10K", "CDM curated labels"],
                "component_semantics": ["Open Images", "SemanticBridge"],
                "environment_context": [
                    "LAS ASPRS classification",
                    "Dynamic World",
                    "Sentinel-2",
                    "Sentinel-1",
                    "Sen1Floods11",
                ],
            },
        })
        return EngineResult(
            engine_id=self.meta.id,
            name=self.meta.name,
            task=self.meta.task,
            status="ok",
            detections=base.detections,
            overlay_png_base64=base.overlay_png_base64,
            metrics=metrics,
            message=(
                "CDM-3 DEV: checkpoint Stage-C não configurado. "
                "Resultado 2D produzido pelo fallback morfológico CDM-1; "
                "nenhuma inferência de IA foi simulada."
            ),
        )

    def predict(self, image: Image.Image):
        checkpoint = self._checkpoint()
        if checkpoint is None:
            return self._bootstrap(image)

        class_map = predict_class_map(str(checkpoint), image)
        records = build_records(
            class_map,
            source_image="uploaded_image",
            inspection_date="",
            mm_per_px=None,
        )
        overlay = render_overlay(image.size, records)
        detections = []
        counts = {}
        for record in records:
            cls = record["damage_class"]
            counts[cls] = counts.get(cls, 0) + 1
            geom = record["geometry"]
            detections.append(Detection(
                label=cls,
                canonical_label=cls,
                score=None,
                box=geom.get("bbox"),
                polygon=geom.get("points_2d"),
                area_px=geom.get("area_px"),
            ))

        # Deterministic morphology remains available as a cross-check, but does
        # not replace the Stage-C output when real CDM-3 weights are configured.
        morphology = CDM1Adapter().predict(image)
        return EngineResult(
            engine_id=self.meta.id,
            name=self.meta.name,
            task=self.meta.task,
            status="ok",
            detections=detections,
            overlay_png_base64=png_b64(overlay),
            metrics={
                "implementation": "CDM-3 3.0.0-dev",
                "runtime_mode": "segformer_stage_c",
                "experimental": True,
                "stage_c_ai_ready": True,
                "stage_c_checkpoint": str(checkpoint),
                "records": records,
                "class_counts": counts,
                "morphology_crosscheck": {
                    "detection_count": len(morphology.detections),
                    "implementation": morphology.metrics.get("implementation"),
                },
                "spatial_pipeline": {
                    "las_summary": "/cdm3/las/summary",
                    "ifc_resolve": "/cdm3/ifc/resolve",
                    "ifc_export": "/cdm3/ifc/export",
                },
            },
            message=(
                "CDM-3 Stage-C executado com checkpoint configurado; "
                "registros 2D estão prontos para enriquecimento LAS/IFC."
            ),
        )
