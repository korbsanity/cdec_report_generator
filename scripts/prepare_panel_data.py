"""Convert user KML polygons to a reproducible GeoJSON row dataset.

Run with Python 3; an optional argument overrides the bundled source directory. Empty KML
polygons are recorded in metadata rather than fabricated into table geometry.
"""
from pathlib import Path
from zipfile import ZipFile
import hashlib
import json
import shutil
import sys
import xml.etree.ElementTree as ET

NS = {"k": "http://www.opengis.net/kml/2.2"}
project = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1]) if len(sys.argv) > 1 else project / "source-data/panel-cleaning"
manifest = json.loads((project / "source-data/panel-cleaning/manifest.json").read_text())
destination = project / "public/panel-cleaning"
destination.mkdir(parents=True, exist_ok=True)
# Remove superseded KML copies so the distributed source selection is unambiguous.
for stale in destination.rglob("*.kml"):
    stale.unlink()
warnings = []


def extract(raw, filename):
    result = []
    for placemark in ET.fromstring(raw).findall(".//k:Placemark", NS):
        name = placemark.findtext("k:name", default="", namespaces=NS)
        for index, polygon in enumerate(placemark.findall(".//k:Polygon", NS)):
            rings = []
            for boundary in ["outerBoundaryIs", "innerBoundaryIs"]:
                for coordinates in polygon.findall(f"k:{boundary}/k:LinearRing/k:coordinates", NS):
                    ring = [list(map(float, token.split(",")[:2])) for token in (coordinates.text or "").split()]
                    if len(ring) < 3:
                        continue
                    if ring[0] != ring[-1]:
                        ring.append(ring[0])
                    rings.append(ring)
                if boundary == "outerBoundaryIs" and not rings:
                    break
            if not rings:
                warnings.append(f"{filename}: polygon {index + 1} has no usable outer coordinates; excluded.")
                continue
            result.append((name, {"type": "Polygon", "coordinates": rings}))
    return result


features, blocks = [], []
for block in range(1, 6):
    rows = []
    source_files = []
    filename = manifest["blocks"][str(block)]["filename"]
    if block == 3:
        with ZipFile(source / filename) as archive:
            for member in sorted(archive.namelist()):
                if member.endswith(".kml") and "__MACOSX" not in member:
                    source_files.append(member)
                    rows.extend(extract(archive.read(member), member))
                    target = destination / "block3" / Path(member).name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(archive.read(member))
    else:
        source_files.append(filename)
        rows = extract((source / filename).read_bytes(), filename)
        shutil.copyfile(source / filename, destination / filename)
    rows.sort(key=lambda item: (
        -sum(c[1] for c in item[1]["coordinates"][0]) / len(item[1]["coordinates"][0]),
        sum(c[0] for c in item[1]["coordinates"][0]) / len(item[1]["coordinates"][0]),
    ))
    seen = set()
    for index, (name, geometry) in enumerate(rows):
        fingerprint = hashlib.sha256(json.dumps(geometry, sort_keys=True).encode()).hexdigest()[:12]
        if fingerprint in seen:
            raise ValueError(f"Duplicate geometry in block {block}")
        seen.add(fingerprint)
        features.append({"type": "Feature", "properties": {
            "id": f"B{block:02d}-{fingerprint}", "row": f"B{block:02d}-R{index + 1:03d}",
            "block": f"B{block}", "sourceName": name,
        }, "geometry": geometry})
    blocks.append({"block": f"B{block}", "rows": len(rows),
                   "actualTables": manifest["blocks"][str(block)]["actualTables"],
                   "sourceFiles": source_files})

metadata = {"geometryVersion": 2, "fullTableMeters": manifest["fullTableMeters"],
            "tableIncrement": 0.25, "blocks": blocks, "warnings": warnings,
            "source": "User-selected KML rows; calibrated against supplied actual block totals. Subdivision boundaries remain estimates."}
# Calibration is part of dataset identity: old quarter IDs cannot be reused
# after changing the physical table definition even if row geometry matches.
metadata["datasetId"] = hashlib.sha256(json.dumps(
    {"features": features, "metadata": metadata}, sort_keys=True).encode()).hexdigest()[:16]
dataset = {"type": "FeatureCollection", "features": features, "metadata": metadata}
(destination / "rows.json").write_text(json.dumps(dataset, separators=(",", ":")))
samples = []
with ZipFile(source / "trial kml.zip") as archive:
    for filename in sorted(archive.namelist()):
        if filename.endswith(".kml") and "__MACOSX" not in filename:
            for name, geometry in extract(archive.read(filename), filename):
                samples.append({"type": "Feature", "properties": {"row": Path(filename).stem}, "geometry": geometry})
(destination / "calibration.json").write_text(json.dumps({"type": "FeatureCollection", "features": samples}))
shutil.copyfile(source / "trial_kml.csv", destination / "trial_kml.csv")
# Keep the supplied trial labels intact and explicitly record their corrected units.
(destination / "calibration-reference.json").write_text(json.dumps({
    "legacyCountMultiplier": 2,
    "note": "Original trial CSV uses the earlier unit; one legacy table equals two actual tables.",
    "fullTableMeters": manifest["fullTableMeters"],
}))
print(json.dumps({"blocks": blocks, "usableRows": len(features), "warnings": warnings}, indent=2))
