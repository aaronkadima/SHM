"""Resolve a 3D pathology record to the nearest structural IFC element."""
from __future__ import annotations
from dataclasses import dataclass
import numpy as np

DEFAULT_TARGET_CLASSES = (
    "IfcSlab", "IfcBeam", "IfcColumn", "IfcMember", "IfcPlate", "IfcWall",
    "IfcFooting", "IfcPile", "IfcBridgePart",
)


@dataclass
class ResolvedComponent:
    ifc_global_id: str
    ifc_class: str
    name: str | None
    distance: float


class IfcGeometryIndex:
    def __init__(self, ifc_file, target_classes=DEFAULT_TARGET_CLASSES):
        import ifcopenshell.geom
        import trimesh
        self.meshes = []
        settings = ifcopenshell.geom.settings()
        settings.set("use-world-coords", True)
        for ifc_class in target_classes:
            try:
                elements = ifc_file.by_type(ifc_class)
            except RuntimeError:
                continue
            for element in elements:
                if not getattr(element, "Representation", None):
                    continue
                try:
                    shape = ifcopenshell.geom.create_shape(settings, element)
                    vertices = np.asarray(shape.geometry.verts, dtype=float).reshape(-1, 3)
                    faces = np.asarray(shape.geometry.faces, dtype=int).reshape(-1, 3)
                except Exception:
                    continue
                if not len(vertices) or not len(faces):
                    continue
                mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
                self.meshes.append((mesh, {
                    "ifc_global_id": element.GlobalId,
                    "ifc_class": element.is_a(),
                    "name": getattr(element, "Name", None),
                }))

    def __len__(self):
        return len(self.meshes)

    def resolve(self, query_xyz, max_distance: float | None = None):
        import trimesh
        point = np.asarray([query_xyz], dtype=float)
        best = None
        for mesh, meta in self.meshes:
            try:
                _, distances, _ = trimesh.proximity.closest_point(mesh, point)
            except Exception:
                # rtree is optional in trimesh; this fallback is slower but dependency-light.
                _, distances, _ = trimesh.proximity.closest_point_naive(mesh, point)
            distance = float(distances[0])
            if best is None or distance < best.distance:
                best = ResolvedComponent(
                    meta["ifc_global_id"], meta["ifc_class"], meta["name"], distance
                )
        if best is not None and max_distance is not None and best.distance > max_distance:
            return None
        return best


def enrich_records_with_host_element(records, index: IfcGeometryIndex, max_distance: float = 0.5):
    stats = {
        "resolved": 0,
        "no_3d_geometry": 0,
        "already_had_host": 0,
        "no_match_within_threshold": 0,
    }
    for record in records:
        if record.get("host_element", {}).get("ifc_global_id"):
            stats["already_had_host"] += 1
            continue
        vertices = record.get("geometry", {}).get("vertices_3d")
        if not vertices:
            stats["no_3d_geometry"] += 1
            continue
        centroid = tuple(np.mean(np.asarray(vertices, dtype=float), axis=0).tolist())
        match = index.resolve(centroid, max_distance=max_distance)
        if match is None:
            stats["no_match_within_threshold"] += 1
            continue
        record["host_element"] = {
            "ifc_global_id": match.ifc_global_id,
            "ifc_class": match.ifc_class,
            "bridge_component": match.name,
        }
        record.setdefault("geometry", {})["host_resolution_distance_m"] = round(match.distance, 6)
        stats["resolved"] += 1
    return records, stats
