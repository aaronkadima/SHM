#!/usr/bin/env python3
"""Contract checks for CDM3-BrIM records consumed by the IFC exporter."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.cdm3.ifc_export import _host_global_id, _properties

record = {
    "id": "cdm3-cracks-1",
    "damage_class": "cracks",
    "host": {
        "express_id": 42,
        "global_id": "3ExampleIfcGlobalId",
        "ifc_type": "IfcBeam",
    },
    "geometry": {"coord_frame": "point_cloud_world", "reprojection_error_px": 1.25},
    "association": {
        "status": "bound",
        "method": "six_axis_surface_raycast",
        "distance": 0.004,
    },
    "provenance": {"detector_confidence_calibrated": False},
}
assert _host_global_id(record) == "3ExampleIfcGlobalId"
props = _properties(record)
assert props["HostExpressID"] == 42
assert props["HostGlobalID"] == "3ExampleIfcGlobalId"
assert props["HostIfcType"] == "IfcBeam"
assert props["AssociationStatus"] == "bound"
assert props["AssociationMethod"] == "six_axis_surface_raycast"
assert props["AssociationDistance"] == 0.004

legacy = {"host_element": {"ifc_global_id": "LegacyGuid"}}
assert _host_global_id(legacy) == "LegacyGuid"
print("CDM3_BRIM_IFC_EXPORT_CONTRACT_PASS")
