"""Export CDM-3 pathology records as IfcAnnotation + Pset + linked SVG."""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import re

PSET_NAME = "Pset_CDM_Pathology"
PSET_FIELD_MAP = {
    "DamageClass": ("damage_class",),
    "GDIndex": ("gd_index",),
    "NBR9452Note": ("nbr9452_note",),
    "AreaMM2": ("geometry", "area_mm2"),
    "CoordFrame": ("geometry", "coord_frame"),
    "ReprojectionErrorPx": ("geometry", "reprojection_error_px"),
    "SourceImage": ("provenance", "source_image"),
    "InspectionDate": ("provenance", "inspection_date"),
    "EngineVersion": ("engine_version",),
    "ConfidenceCalibrated": ("provenance", "detector_confidence_calibrated"),
}


class PathologyExportError(Exception):
    pass


@dataclass
class ExportStats:
    total_records: int = 0
    exported: int = 0
    skipped_missing_host: int = 0
    skipped_bad_geometry: int = 0

    def as_dict(self):
        return {
            "total_records": self.total_records,
            "exported": self.exported,
            "skipped_missing_host": self.skipped_missing_host,
            "skipped_bad_geometry": self.skipped_bad_geometry,
        }


def _dig(record: dict[str, Any], path):
    node = record
    for key in path:
        if not isinstance(node, dict) or key not in node:
            return None
        node = node[key]
    return node


def _ensure_annotation_context(ifc_file):
    import ifcopenshell.api
    model_ctx = next(
        (x for x in ifc_file.by_type("IfcGeometricRepresentationContext")
         if x.ContextType == "Model" and x.is_a("IfcGeometricRepresentationContext")),
        None,
    )
    if model_ctx is None:
        model_ctx = ifcopenshell.api.run("context.add_context", ifc_file, context_type="Model")
    existing = next(
        (x for x in ifc_file.by_type("IfcGeometricRepresentationSubContext")
         if x.ContextIdentifier == "Annotation" and x.ParentContext == model_ctx),
        None,
    )
    return existing or ifcopenshell.api.run(
        "context.add_context", ifc_file, context_type="Model",
        context_identifier="Annotation", target_view="PLAN_VIEW", parent=model_ctx
    )


def _points_from_svg_path(svg_path: str | None):
    if not svg_path:
        return []
    values = [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?", svg_path)]
    return [[values[i], values[i + 1]] for i in range(0, len(values) - 1, 2)]


def _properties(record):
    out = {}
    for name, path in PSET_FIELD_MAP.items():
        value = _dig(record, path)
        if value is not None:
            out[name] = value
    return out


def _find_host(ifc_file, global_id):
    try:
        return ifc_file.by_guid(global_id)
    except RuntimeError:
        return None


def _build_polycurve(ifc_file, points, is_3d):
    coords = [tuple(p[:3] if is_3d else p[:2]) for p in points]
    if len(coords) < 2:
        raise PathologyExportError("Pathology geometry has fewer than 2 points.")
    plist = (
        ifc_file.createIfcCartesianPointList3D(coords)
        if is_3d else ifc_file.createIfcCartesianPointList2D(coords)
    )
    return ifc_file.createIfcIndexedPolyCurve(plist, None, False)


def _export_svg(record, svg_dir: Path):
    import svgwrite
    svg_dir.mkdir(parents=True, exist_ok=True)
    record_id = record.get("id", "cdm3")
    geometry = record.get("geometry", {})
    path_data = geometry.get("svg_path", "")
    points = _points_from_svg_path(path_data)
    if not points:
        raise PathologyExportError("Missing svg_path.")
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    width, height = max(xs) - min(xs) or 1, max(ys) - min(ys) or 1
    out = svg_dir / f"{record_id}.svg"
    dwg = svgwrite.Drawing(str(out), size=(f"{width}mm", f"{height}mm"),
                           viewBox=f"0 0 {width} {height}", debug=False)
    path = dwg.path(d=path_data, fill="none", stroke="red", stroke_width=1)
    path.attribs["data-cdm-id"] = record_id
    path.attribs["data-damage-class"] = record.get("damage_class", "")
    path.attribs["data-coord-frame"] = geometry.get("coord_frame", "")
    path.attribs["data-mm-per-px"] = str(geometry.get("mm_per_px", ""))
    path.attribs["data-ifc-global-id"] = _dig(record, ("host_element", "ifc_global_id")) or ""
    dwg.add(path)
    dwg.save()
    return out


def export_records(ifc_in: Path, records: list[dict], svg_dir: Path, ifc_out: Path):
    import ifcopenshell
    import ifcopenshell.api
    import ifcopenshell.guid
    ifc_file = ifcopenshell.open(str(ifc_in))
    context = _ensure_annotation_context(ifc_file)
    stats = ExportStats(total_records=len(records))
    for record in records:
        host_id = _dig(record, ("host_element", "ifc_global_id"))
        host = _find_host(ifc_file, host_id) if host_id else None
        if host is None:
            stats.skipped_missing_host += 1
            continue
        points = _dig(record, ("geometry", "vertices_3d"))
        is_3d = bool(points)
        if not points:
            points = _points_from_svg_path(_dig(record, ("geometry", "svg_path")))
        if not points:
            stats.skipped_bad_geometry += 1
            continue

        annotation = ifcopenshell.api.run(
            "root.create_entity", ifc_file, ifc_class="IfcAnnotation",
            name=record.get("id", "CDM3_Pathology")
        )
        ifcopenshell.api.run("geometry.edit_object_placement", ifc_file, product=annotation)
        annotation.ObjectPlacement.PlacementRelTo = host.ObjectPlacement
        curve = _build_polycurve(ifc_file, points, is_3d)
        rep = ifc_file.createIfcShapeRepresentation(
            context, "Annotation", "Curve3D" if is_3d else "Curve2D", [curve]
        )
        annotation.Representation = ifc_file.createIfcProductDefinitionShape(None, None, [rep])
        ifc_file.create_entity(
            "IfcRelAssignsToProduct", GlobalId=ifcopenshell.guid.new(),
            OwnerHistory=None, Name="CDM3_AnnotatesElement", Description=None,
            RelatedObjects=[annotation], RelatedObjectsType=None, RelatingProduct=host
        )
        props = _properties(record)
        if props:
            pset = ifcopenshell.api.run("pset.add_pset", ifc_file, product=annotation, name=PSET_NAME)
            ifcopenshell.api.run("pset.edit_pset", ifc_file, pset=pset, properties=props)

        try:
            svg_path = _export_svg(record, svg_dir)
            doc = ifcopenshell.api.run("document.add_information", ifc_file)
            doc.Identification = f"SVG-{record.get('id', 'cdm3')}"
            doc.Name = svg_path.name
            doc.Description = "CDM-3 pathology vector layer"
            doc.Location = svg_path.as_posix()
            ifcopenshell.api.run(
                "document.assign_document", ifc_file, products=[annotation], document=doc
            )
        except Exception:
            # IFC annotation remains valid even if external SVG linking fails.
            pass
        stats.exported += 1

    ifc_out.parent.mkdir(parents=True, exist_ok=True)
    ifc_file.write(str(ifc_out))
    return stats
