#!/usr/bin/env python3
"""Build a combined JSON dataset for the Nova Scotia election dashboard."""

from __future__ import annotations

import json
import re
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import xml.etree.ElementTree as ET


OUTPUT_JSON = (
    Path("/Users/evancolclough/Documents/New project/nova-scotia-poll-dashboard/data")
    / "nova-scotia-poll-results.json"
)
LEGACY_2024_JSON = (
    Path("/Users/evancolclough/Documents/New project/nova-scotia-poll-dashboard/data/sources")
    / "nova-scotia-poll-results-2024.json"
)
SOURCE_WORKBOOKS = {
    "2024": Path("/Users/evancolclough/Downloads/42PGE_PollbyPoll_AllEDs_TurnOut_FINAL.xlsx"),
    "2021": Path("/Users/evancolclough/Downloads/41PGE_PollbyPoll_AllEDs_TurnOut_FINAL.xlsx"),
}

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

CANDIDATE_COLORS = [
    "#1f4db5",
    "#cc2b2b",
    "#f28f16",
    "#2f8f46",
    "#6b4ce6",
    "#0f9ea8",
    "#b04cc2",
    "#c46b1c",
]


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


def first_non_empty(values: list[str], fallback: str = "") -> str:
    for value in values:
        if normalize_text(value):
            return normalize_text(value)
    return fallback


def parse_district_name(raw_title: str, fallback_number: str) -> tuple[str, str]:
    title = normalize_text(raw_title)
    match = re.match(r"^(\d+)\s*-\s*(.+)$", title)
    if match:
        return match.group(1).zfill(2), match.group(2).strip()
    match = re.match(r"^(\d+)\s*-\s*(.+)$", title.replace("-", " - ", 1))
    if match:
        return match.group(1).zfill(2), match.group(2).strip()
    return fallback_number.zfill(2), title


def normalize_party_name(party: str) -> str:
    cleaned = normalize_text(party)
    return {
        "Liberal": "Liberal",
        "Liberal Party": "Liberal",
        "PC Party": "PC Party",
        "Progressive Conservative": "PC Party",
        "NDP": "NSNDP",
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


def is_summary_row_dense(row: list[str]) -> bool:
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


def extract_elected_parts(value: str) -> tuple[str, str]:
    text = normalize_text(value)
    match = re.match(r"^(.*?)\s*\((.*?)\)$", text)
    if not match:
        return text, ""
    return normalize_text(match.group(1)), normalize_party_name(match.group(2))


def stable_color(name: str) -> str:
    if not name:
        return "#5a6472"
    index = sum(ord(char) for char in name) % len(CANDIDATE_COLORS)
    return CANDIDATE_COLORS[index]


def finalize_dataset(
    election_id: str,
    election_label: str,
    source_workbook: str,
    group_mode: str,
    districts: list[dict[str, Any]],
    polls: list[dict[str, Any]],
    entities: list[dict[str, Any]],
    poll_type_counts: dict[str, int],
) -> dict[str, Any]:
    districts.sort(key=lambda district: district["number"])
    total_electors = sum(district["summary"]["electors"] or 0 for district in districts)
    total_votes = sum(district["summary"]["totalVotes"] or 0 for district in districts)
    total_valid_votes = sum(district["summary"]["validVotes"] or 0 for district in districts)
    return {
        "metadata": {
            "electionId": election_id,
            "electionLabel": election_label,
            "sourceWorkbook": source_workbook,
            "groupMode": group_mode,
            "groupLabel": "Party" if group_mode == "party" else "Candidate",
            "districtCount": len(districts),
            "pollCount": len(polls),
            "totalElectors": total_electors,
            "totalVotes": total_votes,
            "totalValidVotes": total_valid_votes,
            "overallTurnoutRate": round(total_votes / total_electors, 4) if total_electors else None,
            "pollTypes": dict(sorted(poll_type_counts.items())),
        },
        "entities": entities,
        "districts": districts,
        "polls": polls,
    }


def wrap_legacy_2024_dataset(path: Path) -> dict[str, Any]:
    legacy = json.loads(path.read_text(encoding="utf-8"))
    entities = legacy.get("parties", [])

    def decorate_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        decorated = []
        for candidate in candidates:
            party = normalize_party_name(candidate.get("party", ""))
            color = candidate.get("color") or PARTY_COLORS.get(party, "#5a6472")
            decorated.append(
                {
                    **candidate,
                    "party": party,
                    "color": color,
                    "groupLabel": party,
                    "groupColor": color,
                }
            )
        return decorated

    districts = []
    for district in legacy["districts"]:
        districts.append(
            {
                **district,
                "candidates": decorate_candidates(district["candidates"]),
            }
        )

    polls = []
    for poll in legacy["polls"]:
        polls.append(
            {
                **poll,
                "candidates": decorate_candidates(poll["candidates"]),
            }
        )

    return finalize_dataset(
        election_id="2024",
        election_label="2024 Election",
        source_workbook=legacy["metadata"]["sourceWorkbook"],
        group_mode="party",
        districts=districts,
        polls=polls,
        entities=entities,
        poll_type_counts=legacy["metadata"]["pollTypes"],
    )


def build_dense_2024_dataset(source_workbook: Path) -> dict[str, Any]:
    with zipfile.ZipFile(source_workbook) as archive:
        shared_strings = read_shared_strings(archive)
        sheet_targets = extract_sheet_targets(archive)

        districts: list[dict[str, Any]] = []
        polls: list[dict[str, Any]] = []
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
            candidates_template = []
            for header in candidate_headers:
                parts = [normalize_text(part) for part in str(header).split("\n") if normalize_text(part)]
                candidate_name = " ".join(parts[:-1]) if len(parts) > 1 else (parts[0] if parts else "")
                party = normalize_party_name(parts[-1] if len(parts) > 1 else "")
                color = PARTY_COLORS.get(party, "#5a6472")
                party_set.add(party)
                candidates_template.append(
                    {
                        "candidate": candidate_name,
                        "party": party,
                        "color": color,
                        "groupLabel": party,
                        "groupColor": color,
                    }
                )

            district_totals: dict[str, Any] | None = None
            district_winner_text = ""
            district_polls: list[dict[str, Any]] = []

            for row in rows[2:]:
                if not any(normalize_text(cell) for cell in row):
                    continue

                first = normalize_text(row[0] if len(row) > 0 else "")
                second = normalize_text(row[1] if len(row) > 1 else "")

                if is_summary_row_dense(row):
                    if second == "Total" or first == "Total":
                        district_candidate_totals = []
                        for index, candidate in enumerate(candidates_template):
                            votes = parse_number(row[4 + index] if len(row) > 4 + index else "") or 0
                            district_candidate_totals.append({**candidate, "votes": votes})
                        district_totals = {
                            "electors": parse_number(row[2] if len(row) > 2 else ""),
                            "totalVotes": parse_number(row[3] if len(row) > 3 else ""),
                            "rejectedBallots": parse_number(row[-2] if len(row) >= 2 else "") or 0,
                            "declinedBallots": parse_number(row[-1] if len(row) >= 1 else "") or 0,
                            "candidates": district_candidate_totals,
                        }
                    elif first == "Elected:" or second == "Elected:":
                        district_winner_text = normalize_text(
                            row[1] if first == "Elected:" else row[2] if len(row) > 2 else row[1]
                        )
                    continue

                poll_code = first
                location = second
                electors = parse_number(row[2] if len(row) > 2 else "")
                total_votes = parse_number(row[3] if len(row) > 3 else "") or 0
                rejected_ballots = parse_number(row[-2] if len(row) >= 2 else "") or 0
                declined_ballots = parse_number(row[-1] if len(row) >= 1 else "") or 0

                candidate_results = []
                for index, candidate in enumerate(candidates_template):
                    votes = parse_number(row[4 + index] if len(row) > 4 + index else "") or 0
                    candidate_results.append({**candidate, "votes": votes})

                valid_votes = sum(candidate["votes"] for candidate in candidate_results)
                for candidate in candidate_results:
                    candidate["voteShare"] = round(candidate["votes"] / valid_votes, 4) if valid_votes else 0

                winner = max(candidate_results, key=lambda item: item["votes"], default=None)
                poll_type = classify_poll_type(poll_code)
                poll_type_counts[poll_type] += 1

                poll_record = {
                    "id": f"2024-{sheet_code}-{poll_code}",
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
                    "turnoutRate": round(total_votes / electors, 4) if electors else None,
                    "winner": {
                        "candidate": winner["candidate"] if winner else "",
                        "party": winner["party"] if winner else "",
                        "votes": winner["votes"] if winner else 0,
                    },
                    "candidates": candidate_results,
                }
                district_polls.append(poll_record)
                polls.append(poll_record)

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
                        totals_by_candidate[(candidate["candidate"], candidate["party"])] += candidate["votes"]
                for candidate in candidates_template:
                    district_totals["candidates"].append(
                        {
                            **candidate,
                            "votes": totals_by_candidate[(candidate["candidate"], candidate["party"])],
                        }
                    )

            district_valid_votes = sum(candidate["votes"] for candidate in district_totals["candidates"])
            for candidate in district_totals["candidates"]:
                candidate["voteShare"] = round(candidate["votes"] / district_valid_votes, 4) if district_valid_votes else 0

            district_top_candidate = max(district_totals["candidates"], key=lambda item: item["votes"], default=None)
            districts.append(
                {
                    "code": sheet_code,
                    "number": district_number,
                    "name": district_name,
                    "displayName": f"{district_number} - {district_name}",
                    "winnerText": district_winner_text,
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
                        "turnoutRate": round(district_totals["totalVotes"] / district_totals["electors"], 4)
                        if district_totals["electors"]
                        else None,
                    },
                    "candidates": district_totals["candidates"],
                    "pollCount": len(district_polls),
                }
            )

    entities = [{"name": party, "color": PARTY_COLORS.get(party, "#5a6472")} for party in sorted(party_set)]
    return finalize_dataset(
        election_id="2024",
        election_label="2024 Election",
        source_workbook=source_workbook.name,
        group_mode="party",
        districts=districts,
        polls=polls,
        entities=entities,
        poll_type_counts=poll_type_counts,
    )


def find_header_row_index(rows: list[list[str]]) -> int:
    for index, row in enumerate(rows):
        normalized = [normalize_text(cell) for cell in row]
        if "Poll" in normalized and any("Polling Location" == value for value in normalized):
            return index
    raise ValueError("Could not locate header row")


def find_column_index(header: list[str], matcher: Any) -> int:
    for index, value in enumerate(header):
        normalized = normalize_text(value)
        if matcher(normalized):
            return index
    raise ValueError("Could not locate required column")


def first_non_empty_index(row: list[str]) -> int:
    for index, value in enumerate(row):
        if normalize_text(value):
            return index
    return -1


def extract_elected_text_from_sparse_row(row: list[str]) -> str:
    for index, value in enumerate(row):
        if normalize_text(value) == "Elected:":
            for next_value in row[index + 1 :]:
                if normalize_text(next_value):
                    return normalize_text(next_value)
    return ""


def build_sparse_2021_dataset(source_workbook: Path) -> dict[str, Any]:
    with zipfile.ZipFile(source_workbook) as archive:
        shared_strings = read_shared_strings(archive)
        sheet_targets = extract_sheet_targets(archive)

        districts: list[dict[str, Any]] = []
        polls: list[dict[str, Any]] = []
        entity_map: dict[str, dict[str, str]] = {}
        poll_type_counts: defaultdict[str, int] = defaultdict(int)

        for sheet_code, target in sheet_targets:
            rows = read_sheet_rows(archive, target, shared_strings)
            if not rows:
                continue

            header_row_index = find_header_row_index(rows)
            header = rows[header_row_index]

            district_number = re.sub(r"\D", "", sheet_code).zfill(2)
            display_name = first_non_empty([first_non_empty(row) for row in rows[:header_row_index]], sheet_code)
            district_number, district_name = parse_district_name(display_name, district_number)

            poll_index = find_column_index(header, lambda value: value == "Poll")
            location_index = find_column_index(header, lambda value: value == "Polling Location")
            electors_index = find_column_index(header, lambda value: value.startswith("Electors"))
            total_votes_index = find_column_index(header, lambda value: value.startswith("Total Votes"))
            rejected_index = find_column_index(header, lambda value: value.startswith("Rejected"))
            declined_index = find_column_index(header, lambda value: value.startswith("Declined"))
            candidate_indices = [
                index
                for index in range(total_votes_index + 1, rejected_index)
                if normalize_text(header[index])
            ]

            candidates_template = []
            for index in candidate_indices:
                candidate_name = normalize_text(header[index])
                color = stable_color(candidate_name)
                entity_map[candidate_name] = {"name": candidate_name, "color": color}
                candidates_template.append(
                    {
                        "candidate": candidate_name,
                        "party": "",
                        "color": color,
                        "groupLabel": candidate_name,
                        "groupColor": color,
                    }
                )

            district_totals: dict[str, Any] | None = None
            district_winner_text = ""
            district_polls: list[dict[str, Any]] = []

            for row in rows[header_row_index + 1 :]:
                if not any(normalize_text(cell) for cell in row):
                    continue

                location_value = normalize_text(row[location_index] if len(row) > location_index else "")
                first_value = normalize_text(row[first_non_empty_index(row)] if first_non_empty_index(row) >= 0 else "")

                if location_value == "Total":
                    district_candidate_totals = []
                    for column_index, candidate in zip(candidate_indices, candidates_template):
                        votes = parse_number(row[column_index] if len(row) > column_index else "") or 0
                        district_candidate_totals.append({**candidate, "votes": votes})
                    district_totals = {
                        "electors": parse_number(row[electors_index] if len(row) > electors_index else ""),
                        "totalVotes": parse_number(row[total_votes_index] if len(row) > total_votes_index else ""),
                        "rejectedBallots": parse_number(row[rejected_index] if len(row) > rejected_index else "") or 0,
                        "declinedBallots": parse_number(row[declined_index] if len(row) > declined_index else "") or 0,
                        "candidates": district_candidate_totals,
                    }
                    continue

                if location_value.startswith("Turnout") or first_value.startswith("*"):
                    continue

                elected_text = extract_elected_text_from_sparse_row(row)
                if elected_text:
                    district_winner_text = elected_text
                    continue

                poll_code = normalize_text(row[poll_index] if len(row) > poll_index else "")
                if not poll_code:
                    continue

                location = normalize_text(row[location_index] if len(row) > location_index else "")
                electors = parse_number(row[electors_index] if len(row) > electors_index else "")
                total_votes = parse_number(row[total_votes_index] if len(row) > total_votes_index else "") or 0
                rejected_ballots = parse_number(row[rejected_index] if len(row) > rejected_index else "") or 0
                declined_ballots = parse_number(row[declined_index] if len(row) > declined_index else "") or 0

                candidate_results = []
                for column_index, candidate in zip(candidate_indices, candidates_template):
                    votes = parse_number(row[column_index] if len(row) > column_index else "") or 0
                    candidate_results.append({**candidate, "votes": votes})

                valid_votes = sum(candidate["votes"] for candidate in candidate_results)
                for candidate in candidate_results:
                    candidate["voteShare"] = round(candidate["votes"] / valid_votes, 4) if valid_votes else 0

                winner = max(candidate_results, key=lambda item: item["votes"], default=None)
                poll_type = classify_poll_type(poll_code)
                poll_type_counts[poll_type] += 1

                poll_record = {
                    "id": f"2021-{sheet_code}-{poll_code}",
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
                    "turnoutRate": round(total_votes / electors, 4) if electors else None,
                    "winner": {
                        "candidate": winner["candidate"] if winner else "",
                        "party": "",
                        "votes": winner["votes"] if winner else 0,
                    },
                    "candidates": candidate_results,
                }
                district_polls.append(poll_record)
                polls.append(poll_record)

            if district_totals is None:
                district_totals = {
                    "electors": sum(poll["electors"] or 0 for poll in district_polls),
                    "totalVotes": sum(poll["totalVotes"] for poll in district_polls),
                    "rejectedBallots": sum(poll["rejectedBallots"] for poll in district_polls),
                    "declinedBallots": sum(poll["declinedBallots"] for poll in district_polls),
                    "candidates": [],
                }
                totals_by_candidate: defaultdict[str, int] = defaultdict(int)
                for poll in district_polls:
                    for candidate in poll["candidates"]:
                        totals_by_candidate[candidate["candidate"]] += candidate["votes"]
                for candidate in candidates_template:
                    district_totals["candidates"].append(
                        {
                            **candidate,
                            "votes": totals_by_candidate[candidate["candidate"]],
                        }
                    )

            district_valid_votes = sum(candidate["votes"] for candidate in district_totals["candidates"])
            for candidate in district_totals["candidates"]:
                candidate["voteShare"] = round(candidate["votes"] / district_valid_votes, 4) if district_valid_votes else 0

            winner_name, winner_party = extract_elected_parts(district_winner_text)
            district_top_candidate = max(district_totals["candidates"], key=lambda item: item["votes"], default=None)
            districts.append(
                {
                    "code": sheet_code,
                    "number": district_number,
                    "name": district_name,
                    "displayName": f"{district_number} - {district_name}",
                    "winnerText": district_winner_text,
                    "winner": {
                        "candidate": winner_name or (district_top_candidate["candidate"] if district_top_candidate else ""),
                        "party": winner_party,
                        "votes": district_top_candidate["votes"] if district_top_candidate else 0,
                    },
                    "summary": {
                        "electors": district_totals["electors"],
                        "totalVotes": district_totals["totalVotes"],
                        "validVotes": district_valid_votes,
                        "rejectedBallots": district_totals["rejectedBallots"],
                        "declinedBallots": district_totals["declinedBallots"],
                        "turnoutRate": round(district_totals["totalVotes"] / district_totals["electors"], 4)
                        if district_totals["electors"]
                        else None,
                    },
                    "candidates": district_totals["candidates"],
                    "pollCount": len(district_polls),
                }
            )

    entities = sorted(entity_map.values(), key=lambda entity: entity["name"])
    return finalize_dataset(
        election_id="2021",
        election_label="2021 Election",
        source_workbook=source_workbook.name,
        group_mode="candidate",
        districts=districts,
        polls=polls,
        entities=entities,
        poll_type_counts=poll_type_counts,
    )


def build_combined_dataset() -> dict[str, Any]:
    if SOURCE_WORKBOOKS["2024"].exists():
        election_2024 = build_dense_2024_dataset(SOURCE_WORKBOOKS["2024"])
    else:
        election_2024 = wrap_legacy_2024_dataset(LEGACY_2024_JSON)

    election_2021 = build_sparse_2021_dataset(SOURCE_WORKBOOKS["2021"])

    return {
        "metadata": {
            "title": "Nova Scotia Poll-by-Poll Dashboard",
            "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
            "defaultElection": "2024",
            "availableElections": [
                {"id": "2024", "label": "2024"},
                {"id": "2021", "label": "2021"},
            ],
        },
        "elections": {
            "2024": election_2024,
            "2021": election_2021,
        },
    }


def main() -> None:
    dataset = build_combined_dataset()
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(dataset, indent=2), encoding="utf-8")
    print(f"Wrote {OUTPUT_JSON}")


if __name__ == "__main__":
    main()
