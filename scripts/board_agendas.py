"""Read the Board of Supervisors agendas and compare them with the cluster motions.

The county publishes each Board agenda as a web page. This program:
1. Gets the list of Board agendas from the Board meeting page.
2. Reads the motions of the Supervisors from each agenda that is new.
3. Saves them in public/data/board_agendas.json.
4. Finds, for each cluster motion, the related item on a Board agenda.
"""
import html
import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BOARD_FILE = ROOT / "public" / "data" / "board_agendas.json"
INDEX_URL = "https://bos.lacounty.gov/board-meeting-agendas/"

AGENDA_LINK = re.compile(
    r'href="(https://assets-us-01\.kc-usercontent\.com/[^"?]+/(\d{6})_((?:Supplemental(?:%20|\s))?Agenda)[^"?/]*\.html)"',
    re.I,
)
ITEM_NUMBER = re.compile(r"^(\d{1,3}(?:-[A-Z])?)\.$")
FILE_NUMBER = re.compile(r"\((\d{2}-\d{4})\)")
SUBMITTED_BY = re.compile(r"^(?:Revised\s+)?Recommendation as submitted by Supervisors?\s+(.+?):", re.I)
PLANNED_DATE = re.compile(r"for\s+([A-Z][a-z]+ \d{1,2},? \d{4})\s+Board Agenda", re.I)
STOP_WORDS = {
    "that", "this", "with", "from", "have", "will", "their", "board", "motion", "county",
    "angeles", "agenda", "department", "supervisor", "into", "within", "through",
}
# A cluster motion normally goes to the Board in two to three weeks.
SEARCH_DAYS = 75
WAIT_DAYS = 35


def list_board_agendas(index_html):
    """Return the Board agendas on the index page as {key: {date, kind, url}}."""
    found = {}
    for url, mmddyy, kind in AGENDA_LINK.findall(index_html):
        meeting = datetime.strptime(mmddyy, "%m%d%y").date().isoformat()
        kind = "supplemental" if kind.lower().startswith("supplemental") else "regular"
        found[f"{meeting}|{kind}"] = {"date": meeting, "kind": kind, "url": url}
    return found


def page_lines(page_html):
    """Return the text lines of an agenda page as (text, link address)."""
    page_html = re.sub(r"<style.*?</style>|<script.*?</script>", "", page_html, flags=re.S | re.I)
    lines = []
    for block in re.findall(r'<div class="stl_01"[^>]*>(.*?)</div>', page_html, flags=re.S):
        link = re.search(r'<a[^>]+href="([^"]+)"', block)
        text = html.unescape(re.sub(r"<[^>]+>", "", block)).replace("\xa0", " ")
        text = re.sub(r"\s+", " ", text).strip()
        if text:
            lines.append((text, link.group(1) if link else None))
    return lines


def parse_board_agenda(page_html):
    """Return the motions of the Supervisors on one Board agenda."""
    lines = page_lines(page_html)
    items = []
    for r, (text, _) in enumerate(lines):
        authors = SUBMITTED_BY.match(text)
        if not authors:
            continue

        # The item number and the title are the lines immediately before the recommendation.
        # The number can be before or after the title.
        number, title_parts = None, []
        for prev_text, prev_link in reversed(lines[max(0, r - 7):r]):
            if prev_link or FILE_NUMBER.search(prev_text) or re.match(r"Attachmen\s?ts", prev_text):
                break
            if re.match(r"^(Page \d+|County of Los Angeles|Board of Supervisors|.*\bAGENDA\b)", prev_text):
                break
            if ITEM_NUMBER.match(prev_text):
                if number:
                    break
                number = ITEM_NUMBER.match(prev_text)
            else:
                title_parts.insert(0, prev_text)
        if not number or not title_parts:
            continue
        i = r - 1

        body, file_number, attachments = [], None, []
        j = i + 1
        while j < len(lines):
            line_text, line_link = lines[j]
            if file_number is None:
                body.append(line_text)
                match = FILE_NUMBER.search(line_text)
                if match:
                    file_number = match.group(1)
            elif line_link:
                attachments.append({"name": re.sub(r"\s+", " ", line_text).replace("Cor respondence", "Correspondence"), "url": line_link})
            elif not re.match(r"Attachmen\s?ts", line_text):
                break
            if len(body) > 80:
                break
            j += 1

        items.append(
            {
                "item_number": number.group(1),
                "title": " ".join(title_parts),
                "authors": authors.group(1).strip(),
                "file_number": file_number,
                "recommendation": " ".join(body)[:700],
                "attachments": attachments,
            }
        )
    return items


def update_board_file(get, log):
    """Download the Board agendas that are new. Return all the saved agendas."""
    saved = json.loads(BOARD_FILE.read_text()) if BOARD_FILE.exists() else {}
    listed = list_board_agendas(get(INDEX_URL).text)
    if not listed:
        raise RuntimeError("The Board meeting page lists no agendas.")
    for key, entry in sorted(listed.items()):
        if key in saved and saved[key]["url"] == entry["url"]:
            continue
        items = parse_board_agenda(get(entry["url"]).content.decode("utf-8", "replace"))
        if entry["kind"] == "regular" and not items:
            raise RuntimeError(f"The reader found no motions on the Board agenda of {entry['date']}.")
        saved[key] = {**entry, "items": items}
        log(f"OK   Board agenda {entry['date']} ({entry['kind']}): {len(items)} motions")
    BOARD_FILE.parent.mkdir(parents=True, exist_ok=True)
    ordered = dict(sorted(saved.items(), reverse=True))
    BOARD_FILE.write_text(json.dumps(ordered, indent=1, ensure_ascii=False) + "\n")
    return ordered


def _subject(title):
    """Return the subject of a cluster motion title, without labels and notes."""
    quoted = re.search(r"[“\"]\s*(.{8,})[”“\"]", title)
    if quoted:
        return quoted.group(1)
    title = re.sub(r"^SD[\s-]?\d(\s*(and|&|/|,)\s*SD[\s-]?\d)*\s*[:•\-–]?\s*", "", title, flags=re.I)
    return re.sub(r"\s+-\s+(Added|Revised|Continued).*$", "", title, flags=re.I)


def _tokens(text):
    words = re.findall(r"[a-z0-9]{4,}", text.lower())
    return [w for w in dict.fromkeys(words) if w not in STOP_WORDS]


def _same_words(a, b):
    return re.sub(r"[^a-z0-9]", "", a.lower()) == re.sub(r"[^a-z0-9]", "", b.lower())


def find_on_board(motion_title, cluster_date, board, today):
    """Return the Board status of one cluster motion."""
    subject = _subject(motion_title)
    tokens = _tokens(subject)
    start = date.fromisoformat(cluster_date)
    end = start + timedelta(days=SEARCH_DAYS)
    planned = PLANNED_DATE.search(motion_title)
    planned_date = None
    if planned:
        try:
            planned_date = datetime.strptime(planned.group(1).replace(",", ""), "%B %d %Y").date().isoformat()
        except ValueError:
            planned_date = None

    in_window = [a for a in board.values() if start < date.fromisoformat(a["date"]) <= end]
    hits = []
    for agenda in in_window:
        for item in agenda["items"]:
            title_tokens = set(_tokens(item["title"]))
            if not tokens or not title_tokens:
                continue
            score = sum(1 for t in tokens if t in title_tokens) / len(tokens)
            back = sum(1 for t in title_tokens if t in tokens) / len(title_tokens)
            if score >= 0.75 and back >= 0.5:
                hits.append((agenda["date"], -score, agenda, item))

    if hits:
        hits.sort(key=lambda h: (h[0], h[1]))
        _, _, agenda, item = hits[0]
        names = [a["name"] for a in item["attachments"]]
        return {
            "status": "on_board_agenda",
            "board_date": agenda["date"],
            "agenda_kind": agenda["kind"],
            "agenda_url": agenda["url"],
            "item_number": item["item_number"],
            "board_title": item["title"],
            "authors": item["authors"],
            "file_number": item["file_number"],
            "attachments": [a for a in item["attachments"] if "Correspondence" not in a["name"]],
            "planned_date": planned_date,
            "date_changed": bool(planned_date and planned_date != agenda["date"]),
            "title_changed": not _same_words(subject, re.sub(r"^REVISE:\s*", "", item["title"])),
            "revised_after_cluster": item["title"].startswith("REVISE:")
            or any(re.search(r"revised|updates following cluster", n, re.I) for n in names),
            "other_dates": sorted({h[0] for h in hits} - {agenda["date"]}),
        }

    # The Board meeting page shows only the last months. Without an agenda from the two weeks
    # after the cluster meeting, the comparison is not reliable.
    first_saved = min((a["date"] for a in board.values()), default="9999")
    deadline = max(start + timedelta(days=WAIT_DAYS), date.fromisoformat(planned_date) if planned_date else start)
    if first_saved > (start + timedelta(days=13)).isoformat():
        status = "no_board_data"
    elif today <= deadline:
        status = "waiting"
    else:
        status = "not_found"
    return {"status": status, "planned_date": planned_date}
