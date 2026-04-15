#!/usr/bin/env python3
"""Convert the Nova Scotia poll-by-poll workbook into static JSON."""

from __future__ import annotations

import json
import re
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import xml.etree.ElementTree as ET


SOURCE_WORKBOOK = Path("/Users/evancolclough/Downloads/42PGE_PollbyPoll_AllEDs_TurnOut_FINAL.xlsx")
OUTPUT_JSON = (
    Path("/Users/evancolclough/Documents/New project/nova-scotia-poll-dashboard/data")
    / "nova-scotia-poll-results.json"
)

NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pkgrel": "http://schemas.openxmlformats.org/package/2006/relationships",
}

PARTY_COLORS = {
    "PC Party": "#1f4db5",
    "Liberal": "#cc2b2b",
    "NSNDP": "#f28f16",
    "Green Party": "#2f8f46",
    "Independent": "#6b4ce6",
}


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).replace("\xa0", " ")
    text = text.replace("\n", " ")
    return re.sub(r"\s+", " ", text).strip()


def parse_number(value: Any) -> int | None:
    text = normalize_text(value)
    if not text:
        return None
    try:
        return int(round(float(text)))
    except ValueError:
        return None


def column_to_index(cell_ref: str) -> int:
    letters = re.match(r"([A-Z]+)", cell_ref)
    if not letters:
        return 0
    result = 0
    for char in letters.group(1):
        result = result * 26 + (ord(char) - 64)
    return result - 1


def read_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    shared_strings: list[str] = []
    for item in root.findall("main:si", NS):
        text = "".join(node.text or "" for node in item.iterfind(".//main:t", NS))
        shared_strings.append(text)
    return shared_strings


def read_cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.iterfind(".//main:t", NS))

    value = cell.find("main:v", NS)
    if value is None or value.text is None:
        return ""

    if cell_type == "s":
        return shared_strings[int(value.text)]
    if cell_type == "b":
        return "TRUE" if value.text == "1" else "FALSE"
    return value.text


def read_sheet_rows(archive: zipfile.ZipFile, target: str, shared_strings: list[str]) -> list[list[str]]:
    root = ET.fromstring(archive.read(f"xl/{target}"))
    rows: list[list[str]] = []
    for row in root.findall("main:sheetData/main:row", NS):
        values: list[str] = []
        for cell in row.findall("main:c", NS):
            index = column_to_index(cell.attrib.get("r", "A1"))
            while len(values) <= index:
                values.append("")
            values[index] = read_cell_value(cell, shared_strings)
        rows.append(values)
    return rows


def extract_sheet_targets(archive: zipfile.ZipFile) -> list[tuple[str, str]]:
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    rel_map = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels.findall("pkgrel:Relationship", NS)}

    targets: list[tuple[str, str]] = []
    for sheet in workbook.findall("main:sheets/main:sheet", NS):
        name = sheet.attrib["name"]
        rel_id = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
        targets.append((name, rel_map[rel_id]))
    return targets


def split_candidate_header(header: str) -> tuple[str, str]:
    parts = [normalize_text(part) for part in str(header).split("\n") if normalize_text(part)]
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return " ".join(parts[:-1]), parts[-1]


def normalize_party_name(party: str) -> str:
    cleaned = normalize_text(party)
    return {
        "Liberal": "Liberal",
        "Liberal Party": "Liberal",
        "PC Party": "PC Party",
        "Progressive Conservative": "PC Party",
        "NSNDP": "NSNDP",
        "Green Party": "Green Party",
        "Independent": "Independent",
    }.get(cleaned, cleaned)


def classify_poll_type(poll_code: str) -> str:
    code = normalize_text(poll_code)
    lowered = code.lower()
    if "mobile" in lowered:
        return "Mobile"
    if "out-of-district" in lowered:
        return "Out-of-District"
    if lowered.startswith("ro-"):
        return "Returning Office"
    if lowered.startswith("cp"):
        return "Central Poll"
    if "/" in code:
        return "Combined Poll"
    return "Regular Poll"


def is_summary_row(row: list[str]) -> bool:
    first = normalize_text(row[0] if len(row) > 0 else "")
    second = normalize_text(row[1] if len(row) > 1 else "")
    markers = {first, second}
    if "Total" in markers:
        return True
    if "Turnout" in markers:
        return True
    if "% of Valid Votes Cast" in markers:
        return True
    if "Elected:" in markers:
        return True
    if first.startswith("*") or second.startswith("*"):
        return True
    return False


def parse_district_name(raw_title: str, fallback_number: str) -> tuple[str, str]:
    title = normalize_text(raw_title)
    match = re.match(r"^(\d+)\s*-\s*(.+)$", title)
    if match:
        return match.group(1).zfill(2), match.group(2).strip()
    return fallback_number.zfill(2), title


def first_non_empty(values: list[str], fallback: str = "") -> str:
    for value in values:
        if normalize_text(value):
            return normalize_text(value)
    return fallback


def build_dataset(source_workbook: Path) -> dict[str, Any]:
    with zipfile.ZipFile(source_workbook) as archive:
        shared_strings = read_shared_strings(archive)
        sheet_targets = extract_sheet_targets(archive)

        districts: list[dict[str, Any]] = []
        all_polls: list[dict[str, Any]] = []
        party_set: set[str] = set()
        poll_type_counts: defaultdict[str, int] = defaultdict(int)

        for sheet_code, target in sheet_targets:
            rows = read_sheet_rows(archive, target, shared_strings)
            if len(rows) < 2:
                continue

            district_number = re.sub(r"\D", "", sheet_code).zfill(2)
            display_name = first_non_empty(rows[0] if rows else [], sheet_code)
            district_number, district_name = parse_district_name(display_name, district_number)

            headers = rows[1]
            candidate_headers = headers[4:-2]
            candidates = []
            for header in candidate_headers:
                candidate_name, party = split_candidate_header(header)
                normalized_party = normalize_party_name(party)
                party_set.add(normalized_party)
                candidates.append(
                    {
                        "candidate": candidate_name,
                        "party": normalized_party,
                        "color": PARTY_COLORS.get(normalized_party, "#5a6472"),
                    }
                )

            district_totals: dict[str, Any] | None = None
            district_winner = ""
            district_polls: list[dict[str, Any]] = []

            for row in rows[2:]:
                if not any(normalize_text(cell) for cell in row):
                    continue

                first = normalize_text(row[0] if len(row) > 0 else "")
                second = normalize_text(row[1] if len(row) > 1 else "")

                if is_summary_row(row):
                    if second == "Total" or first == "Total":
                        district_candidate_totals = []
                        for index, candidate in enumerate(candidates):
                            votes = parse_number(row[4 + index] if len(row) > 4 + index else "")
                            district_candidate_totals.append(
                                {
                                    **candidate,
                                    "votes": votes or 0,
                                }
                            )

                        district_totals = {
                            "electors": parse_number(row[2] if len(row) > 2 else ""),
                            "totalVotes": parse_number(row[3] if len(row) > 3 else ""),
                            "rejectedBallots": parse_number(row[-2] if len(row) >= 2 else "") or 0,
                            "declinedBallots": parse_number(row[-1] if len(row) >= 1 else "") or 0,
                            "candidates": district_candidate_totals,
                        }
                    elif first == "Elected:" or second == "Elected:":
                        district_winner = normalize_text(row[1] if first == "Elected:" else row[2] if len(row) > 2 else row[1])
                    continue

                poll_code = first
                location = second
                electors = parse_number(row[2] if len(row) > 2 else "")
                total_votes = parse_number(row[3] if len(row) > 3 else "") or 0
                rejected_ballots = parse_number(row[-2] if len(row) >= 2 else "") or 0
                declined_ballots = parse_number(row[-1] if len(row) >= 1 else "") or 0

                candidate_results = []
                for index, candidate in enumerate(candidates):
                    votes = parse_number(row[4 + index] if len(row) > 4 + index else "") or 0
                    candidate_results.append(
                        {
                            **candidate,
                            "votes": votes,
                        }
                    )

                valid_votes = sum(candidate["votes"] for candidate in candidate_results)
                winner = max(candidate_results, key=lambda item: item["votes"], default=None)
                turnout_rate = round(total_votes / electors, 4) if electors else None
                poll_type = classify_poll_type(poll_code)
                poll_type_counts[poll_type] += 1

                for candidate in candidate_results:
                    candidate["voteShare"] = round(candidate["votes"] / valid_votes, 4) if valid_votes else 0

                poll_record = {
                    "id": f"{sheet_code}-{poll_code}",
                    "districtCode": sheet_code,
                    "districtNumber": district_number,
                    "districtName": district_name,
                    "districtDisplayName": f"{district_number} - {district_name}",
                    "pollCode": poll_code,
                    "pollType": poll_type,
                    "location": location,
                    "electors": electors,
                    "totalVotes": total_votes,
                    "validVotes": valid_votes,
                    "rejectedBallots": rejected_ballots,
                    "declinedBallots": declined_ballots,
                    "turnoutRate": turnout_rate,
                    "winner": {
                        "candidate": winner["candidate"] if winner else "",
                        "party": winner["party"] if winner else "",
                        "votes": winner["votes"] if winner else 0,
                    },
                    "candidates": candidate_results,
                }
                district_polls.append(poll_record)
                all_polls.append(poll_record)

            if district_totals is None:
                district_totals = {
                    "electors": sum(poll["electors"] or 0 for poll in district_polls),
                    "totalVotes": sum(poll["totalVotes"] for poll in district_polls),
                    "rejectedBallots": sum(poll["rejectedBallots"] for poll in district_polls),
                    "declinedBallots": sum(poll["declinedBallots"] for poll in district_polls),
                    "candidates": [],
                }
                totals_by_candidate: defaultdict[tuple[str, str], int] = defaultdict(int)
                for poll in district_polls:
                    for candidate in poll["candidates"]:
                        key = (candidate["candidate"], candidate["party"])
                        totals_by_candidate[key] += candidate["votes"]
                for candidate in candidates:
                    votes = totals_by_candidate[(candidate["candidate"], candidate["party"])]
                    district_totals["candidates"].append({**candidate, "votes": votes})

            district_valid_votes = sum(candidate["votes"] for candidate in district_totals["candidates"])
            district_turnout = (
                round(district_totals["totalVotes"] / district_totals["electors"], 4)
                if district_totals["electors"]
                else None
            )
            district_top_candidate = max(
                district_totals["candidates"],
                key=lambda item: item["votes"],
                default=None,
            )

            for candidate in district_totals["candidates"]:
                candidate["voteShare"] = (
                    round(candidate["votes"] / district_valid_votes, 4) if district_valid_votes else 0
                )

            districts.append(
                {
                    "code": sheet_code,
                    "number": district_number,
                    "name": district_name,
                    "displayName": f"{district_number} - {district_name}",
                    "winnerText": district_winner,
                    "winner": {
                        "candidate": district_top_candidate["candidate"] if district_top_candidate else "",
                        "party": district_top_candidate["party"] if district_top_candidate else "",
                        "votes": district_top_candidate["votes"] if district_top_candidate else 0,
                    },
                    "summary": {
                        "electors": district_totals["electors"],
                        "totalVotes": district_totals["totalVotes"],
                        "validVotes": district_valid_votes,
                        "rejectedBallots": district_totals["rejectedBallots"],
                        "declinedBallots": district_totals["declinedBallots"],
                        "turnoutRate": district_turnout,
                    },
                    "candidates": district_totals["candidates"],
                    "pollCount": len(district_polls),
                }
            )

        districts.sort(key=lambda district: district["number"])

        total_electors = sum(district["summary"]["electors"] or 0 for district in districts)
        total_votes = sum(district["summary"]["totalVotes"] or 0 for district in districts)
        total_valid_votes = sum(district["summary"]["validVotes"] or 0 for district in districts)

        return {
            "metadata": {
                "title": "Nova Scotia Poll-by-Poll Dashboard",
                "election": "42nd Provincial General Election",
                "sourceWorkbook": source_workbook.name,
                "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
                "districtCount": len(districts),
                "pollCount": len(all_polls),
                "totalElectors": total_electors,
                "totalVotes": total_votes,
                "totalValidVotes": total_valid_votes,
                "overallTurnoutRate": round(total_votes / total_electors, 4) if total_electors else None,
                "pollTypes": dict(sorted(poll_type_counts.items())),
            },
            "parties": [
                {
                    "name": party,
                    "color": PARTY_COLORS.get(party, "#5a6472"),
                }
                for party in sorted(party_set)
            ],
            "districts": districts,
            "polls": all_polls,
        }


def main() -> None:
    dataset = build_dataset(SOURCE_WORKBOOK)
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(dataset, indent=2), encoding="utf-8")
    print(f"Wrote {OUTPUT_JSON}")


if __name__ == "__main__":
    main()
