#!/usr/bin/env python3
"""Create a compact browser catalog of Esri World Imagery Wayback releases."""

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.request import urlopen
from xml.etree import ElementTree as ET


CAPABILITIES_URL = (
    "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/"
    "MapServer/WMTS/1.0.0/WMTSCapabilities.xml"
)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
WMTS_NS = {
    "wmts": "https://www.opengis.net/wmts/1.0",
    "ows": "https://www.opengis.net/ows/1.1",
}


def main() -> None:
    root = ET.fromstring(urlopen(CAPABILITIES_URL, timeout=30).read())
    releases = []
    for layer in root.findall(".//wmts:Contents/wmts:Layer", WMTS_NS):
        title = layer.findtext("ows:Title", namespaces=WMTS_NS) or ""
        identifier = layer.findtext("ows:Identifier", namespaces=WMTS_NS) or ""
        resource = layer.find("wmts:ResourceURL", WMTS_NS)
        date_match = re.search(r"(\d{4}-\d{2}-\d{2})", title)
        if resource is None or not date_match:
            continue
        template = resource.attrib["template"].replace(
            "{TileMatrixSet}", "GoogleMapsCompatible"
        ).replace("{TileMatrix}", "{z}").replace("{TileRow}", "{y}").replace(
            "{TileCol}", "{x}"
        )
        releases.append(
            {
                "id": identifier,
                "label": date_match.group(1),
                "releaseDate": date_match.group(1),
                "url": template,
            }
        )

    catalog = {
        "current": {
            "id": "current",
            "label": "Current imagery",
            "releaseDate": None,
            "url": (
                "https://server.arcgisonline.com/ArcGIS/rest/services/"
                "World_Imagery/MapServer/tile/{z}/{y}/{x}"
            ),
        },
        "releases": releases,
        "note": "Wayback dates are Esri publication dates, not necessarily imagery acquisition dates.",
    }
    output = PROJECT_ROOT / "public" / "data" / "esri-wayback.json"
    output.write_text(json.dumps(catalog, separators=(",", ":")), encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
