# CDM-1

CDM-1 reuses the user's Concrete Damage Morphology v2.8.5 Python source in
`app/cdm_v285.py`. It runs its five-stage image morphology protocol on the
backend: base image, family-specific response, candidate mask, opening and
closing, and connected-component filtering. It keeps the original layer order:
exposed reinforcement, spalling, apparent corrosion, efflorescence, cracks.

The response exposes one transparent PNG per family in `metrics.layers` and
one detection per accepted CDM record. The frontend displays these layers
independently. The source's condition rating, t0/t1 comparison, SVG/DXF/IFC,
HTML, and COCO exports are not wired into the SHM analysis API yet. The
classifications are morphological candidates; scores are deliberately null.

For individual inference, start `uvicorn app.standalone:app` from `backend/`
and set its HTTPS address in SHM Settings. `/infer` accepts the optional form
fields `cdm_threshold`, `cdm_kernel_size`, `cdm_min_area`, and
`cdm_min_aspect_ratio`. The multi-engine comparator executes CDM-1 with the
source defaults. The public comparator only accepts two or more engines.

The source file was copied from the user's `concrete_damage_morphology_v285_native.py`
artifact; keep it in sync when the Inkscape extension changes.
