#!/usr/bin/env python3
"""Convert the supplied KML archives into browser-ready GeoJSON."""

from __future__ import annotations

import json
import re
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile


KML_NS = {"k": "http://www.opengis.net/kml/2.2"}
PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = PROJECT_ROOT / "source-data"


def read_polygons(zip_path: Path, kind: str, skip_names: set[str] | None = None) -> list[dict]:
    features: list[dict] = []
    with ZipFile(zip_path) as archive:
        for member in sorted(name for name in archive.namelist() if name.lower().endswith(".kml")):
            root = ET.fromstring(archive.read(member))
            placemark = root.find(".//k:Placemark", KML_NS)
            if placemark is None:
                continue

            name = placemark.findtext("k:name", default=Path(member).stem, namespaces=KML_NS)
            name = name.removesuffix(".kml")
            if name in (skip_names or set()):
                continue
            coordinate_text = placemark.findtext(
                ".//k:Polygon/k:outerBoundaryIs/k:LinearRing/k:coordinates",
                namespaces=KML_NS,
            )
            if not coordinate_text:
                continue

            coordinates = [
                [float(parts[0]), float(parts[1])]
                for token in coordinate_text.split()
                if len(parts := token.split(",")) >= 2
            ]

            if coordinates[0] != coordinates[-1]:
                coordinates.append(coordinates[0])

            if kind == "panel" and name == "B1-PANELS":
                name = "B3-PANELS"

            features.append(feature(name, kind, coordinates, member))

    return features


def feature(name: str, kind: str, ring: list[list[float]], source: str) -> dict:
    block_match = re.match(r"^B(\d+)", name, flags=re.IGNORECASE)
    return {
        "type": "Feature",
        "properties": {
            "name": name,
            "kind": kind,
            "blockId": f"B{block_match.group(1)}" if block_match else None,
            "source": source,
        },
        "geometry": {"type": "Polygon", "coordinates": [ring]},
    }


def collection(features: list[dict]) -> dict:
    return {"type": "FeatureCollection", "features": features}


def main() -> None:
    panels = read_polygons(SOURCE_ROOT / "PANELS.zip", "panel", {"B5-PANELS"})
    panels.extend(read_polygons(SOURCE_ROOT / "BLOCK 5.zip", "panel"))
    data = {
        "metadata": {
            "panelWeight": 0.286,
            "sourceNote": (
                "Plant sections are grouped by B1-B5; B1-PANELS is mapped to B3-PANELS; "
                "B5 panels use the revised east and west polygons."
            ),
        },
        "blocks": collection(read_polygons(SOURCE_ROOT / "PLANT AREA.zip", "block")),
        "panels": collection(panels),
        "exclusions": collection(read_polygons(SOURCE_ROOT / "DENOMITOR.zip", "exclusion")),
    }

    output = PROJECT_ROOT / "public" / "data" / "site-geometry.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
