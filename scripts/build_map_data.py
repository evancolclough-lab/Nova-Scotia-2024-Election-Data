#!/usr/bin/env python3
"""Build a static polling-division GeoJSON dataset from the March 2026 KMZ."""

from __future__ import annotations

import argparse
import html
import json
import math
import re
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_INPUT = Path("/Users/evancolclough/Downloads/ProvincialPollingDivisionPolygons_March_2026.kmz")
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "data" / "nova-scotia-poll-map.json"
COORDINATE_PRECISION = 5
SIMPLIFICATION_TOLERANCE = 0.00005
KML_NS = {"kml": "http://www.opengis.net/kml/2.2"}
FIELD_PATTERN = re.compile(r"<td>([^<]+)</td>\s*<td>(.*?)</td>", re.IGNORECASE | re.DOTALL)


def clean_value(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", html.unescape(value or ""))
    value = value.replace("\xa0", " ").strip()
    if value == "<Null>":
        return ""
    return value


def parse_description_properties(description: str) -> dict[str, str]:
    extracted = {key: clean_value(value) for key, value in FIELD_PATTERN.findall(html.unescape(description or ""))}
    district_code = extracted.get("ED_NO", "").zfill(2)
    poll_code = extracted.get("PD_NO", "").strip()

    elector_count = extracted.get("electorcount") or extracted.get("electorcou") or ""
    try:
        elector_count = int(elector_count)
    except (TypeError, ValueError):
        elector_count = None

    return {
        "id": f"{district_code}-{poll_code}" if district_code and poll_code else "",
        "districtCode": district_code,
        "districtName": extracted.get("ED_NAME", "").strip(),
        "pollCode": poll_code,
        "individualPoll": extracted.get("IND_POLL", "").strip(),
        "residentialCare": extracted.get("RES_CARE", "").strip(),
        "serviceArea": extracted.get("SERVICE_AREA", "").strip(),
        "releaseDate": extracted.get("RELEASE_DATE", "").strip(),
        "electorCount": elector_count,
    }


def parse_coordinate_pair(raw_pair: str) -> list[float] | None:
    parts = raw_pair.split(",")
    if len(parts) < 2:
        return None

    try:
        lon = round(float(parts[0]), COORDINATE_PRECISION)
        lat = round(float(parts[1]), COORDINATE_PRECISION)
    except ValueError:
        return None

    return [lon, lat]


def parse_ring(boundary: ET.Element) -> list[list[float]]:
    coordinates_text = boundary.findtext(".//kml:coordinates", default="", namespaces=KML_NS).strip()
    if not coordinates_text:
        return []

    ring: list[list[float]] = []
    previous: list[float] | None = None

    for pair in coordinates_text.split():
        coordinate = parse_coordinate_pair(pair)
        if coordinate is None or coordinate == previous:
            continue
        ring.append(coordinate)
        previous = coordinate

    if ring and ring[0] != ring[-1]:
        ring.append(ring[0])

    if len(ring) < 4:
        return []

    return simplify_ring(ring, SIMPLIFICATION_TOLERANCE)


def perpendicular_distance(point: list[float], start: list[float], end: list[float]) -> float:
    if start == end:
        return math.hypot(point[0] - start[0], point[1] - start[1])

    x0, y0 = point
    x1, y1 = start
    x2, y2 = end
    numerator = abs((y2 - y1) * x0 - (x2 - x1) * y0 + x2 * y1 - y2 * x1)
    denominator = math.hypot(y2 - y1, x2 - x1)
    return numerator / denominator


def simplify_line(points: list[list[float]], epsilon: float) -> list[list[float]]:
    if len(points) < 3:
        return points

    start = points[0]
    end = points[-1]
    furthest_index = -1
    furthest_distance = 0.0

    for index in range(1, len(points) - 1):
        distance = perpendicular_distance(points[index], start, end)
        if distance > furthest_distance:
            furthest_index = index
            furthest_distance = distance

    if furthest_distance <= epsilon:
        return [start, end]

    left = simplify_line(points[: furthest_index + 1], epsilon)
    right = simplify_line(points[furthest_index:], epsilon)
    return left[:-1] + right


def simplify_ring(ring: list[list[float]], epsilon: float) -> list[list[float]]:
    if len(ring) <= 10:
        return ring

    work = ring[:-1]
    simplified = simplify_line(work, epsilon)

    if simplified[0] != simplified[-1]:
        simplified.append(simplified[0])

    if len(simplified) < 4:
        return ring

    return simplified


def polygon_rings(polygon: ET.Element) -> list[list[list[float]]]:
    rings: list[list[list[float]]] = []

    for boundary_tag in ("outerBoundaryIs", "innerBoundaryIs"):
        for boundary in polygon.findall(f"kml:{boundary_tag}", KML_NS):
            ring = parse_ring(boundary)
            if ring:
                rings.append(ring)

    return rings


def parse_geometry(placemark: ET.Element) -> dict[str, object] | None:
    polygons: list[list[list[list[float]]]] = []

    for polygon in placemark.findall(".//kml:Polygon", KML_NS):
        rings = polygon_rings(polygon)
        if rings:
            polygons.append(rings)

    if not polygons:
        return None

    if len(polygons) == 1:
        return {"type": "Polygon", "coordinates": polygons[0]}

    return {"type": "MultiPolygon", "coordinates": polygons}


def walk_points(geometry: dict[str, object]):
    geometry_type = geometry["type"]
    coordinates = geometry["coordinates"]

    if geometry_type == "Polygon":
        for ring in coordinates:
            for point in ring:
                yield point
        return

    for polygon in coordinates:
        for ring in polygon:
            for point in ring:
                yield point


def build_feature(placemark: ET.Element) -> dict[str, object] | None:
    properties = parse_description_properties(placemark.findtext("kml:description", default="", namespaces=KML_NS))
    geometry = parse_geometry(placemark)

    if not geometry or not properties["districtCode"] or not properties["pollCode"]:
        return None

    return {"type": "Feature", "properties": properties, "geometry": geometry}


def build_map_dataset(input_path: Path) -> dict[str, object]:
    with zipfile.ZipFile(input_path) as archive:
        root = ET.fromstring(archive.read("doc.kml"))

    features: list[dict[str, object]] = []
    district_counts: defaultdict[tuple[str, str], int] = defaultdict(int)
    min_lon = min_lat = float("inf")
    max_lon = max_lat = float("-inf")

    for placemark in root.findall(".//kml:Placemark", KML_NS):
        feature = build_feature(placemark)
        if feature is None:
            continue

        features.append(feature)

        properties = feature["properties"]
        district_counts[(properties["districtCode"], properties["districtName"])] += 1

        for lon, lat in walk_points(feature["geometry"]):
            min_lon = min(min_lon, lon)
            min_lat = min(min_lat, lat)
            max_lon = max(max_lon, lon)
            max_lat = max(max_lat, lat)

    district_index = [
        {
            "code": code,
            "name": name,
            "pollingDivisionCount": count,
        }
        for (code, name), count in sorted(district_counts.items())
    ]

    return {
        "type": "FeatureCollection",
        "metadata": {
            "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
            "sourceKmz": input_path.name,
            "featureCount": len(features),
            "districtCount": len(district_index),
            "coordinatePrecision": COORDINATE_PRECISION,
            "simplificationTolerance": SIMPLIFICATION_TOLERANCE,
            "bounds": [min_lon, min_lat, max_lon, max_lat],
        },
        "districts": district_index,
        "features": features,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="Path to the March 2026 KMZ file.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Where to write the browser-ready map JSON.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    dataset = build_map_dataset(args.input.expanduser())

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(dataset, separators=(",", ":")), encoding="utf-8")

    print(
        f"Wrote {dataset['metadata']['featureCount']} polling-division features "
        f"across {dataset['metadata']['districtCount']} districts to {args.output}"
    )


if __name__ == "__main__":
    main()
