"""Read one cluster agenda PDF and find its Board Motion items.

The reader uses fixed rules only. It does not use an AI model.
It returns the meeting time, the Teams link, and one record for each motion.
Each record gives the item number, the title, the first page of the backup
materials, and the text of the backup materials.
"""
import re

import pymupdf

MAX_AGENDA_PAGES = 8
MAX_BACKUP_PAGES = 12
MAX_BACKUP_CHARS = 30000

HEADING_DIGIT = re.compile(r"^(\d{1,2})\s*[.)]\s+(\S.*)$")
HEADING_ROMAN = re.compile(r"^([IVX]{1,5})\s*[.)]\s+(\S.*)$")
MOTION_TITLE = re.compile(r"^(BOARD\s+)?MOTIONS?(\s+ITEMS?)?\s*(\(S\))?\s*:?\s*(.*)$", re.I)
ITEM_MARK = re.compile(r"^\(?([A-Za-z]{1,2})\s*[.)]\s+(\S.*)$")
NOTHING = re.compile(r"^[\s\-–—]*(none|no\s+items?|n/?a)?[\s\-–—.]*$", re.I)
PAGE_NOISE = re.compile(
    r"^(page\s+)?\d+(\s+of\s+\d+)?$|^(monday|tuesday|wednesday|thursday|friday),?\s+\w+\s+\d{1,2},?\s+\d{4}$",
    re.I,
)
ADJOURN = re.compile(r"adjourn", re.I)
STOP_WORDS = {
    "that", "this", "with", "from", "have", "will", "been", "their", "board", "motion",
    "motions", "county", "angeles", "agenda", "department", "supervisor", "supervisors",
    "item", "items", "report", "back", "into", "within", "such", "other", "also",
}
END_OF_MOTION = re.compile(r"#\s*#\s*#")
NEW_DOCUMENT = re.compile(
    r"CLUSTER FACT SHEET|^\s*Dear Supervisors|BOARD LETTER\s*/\s*MEMO", re.I | re.M
)


def page_lines(page):
    """Return the text lines of a page as (left position, text), top to bottom."""
    rows = []
    for w in sorted(page.get_text("words"), key=lambda w: ((w[1] + w[3]) / 2, w[0])):
        yc = (w[1] + w[3]) / 2
        if rows and abs(rows[-1][0] - yc) < 3:
            rows[-1][1].append(w)
        else:
            rows.append([yc, [w]])
    lines = []
    for _, words in rows:
        words.sort(key=lambda w: w[0])
        lines.append((words[0][0], " ".join(w[4] for w in words)))
    return lines


def _clean(text):
    return re.sub(r"\s+", " ", text).strip(" :;-–—•")


def _tokens(text):
    words = re.findall(r"[a-z0-9]{4,}", text.lower())
    return [w for w in dict.fromkeys(words) if w not in STOP_WORDS]


def read_front_matter(doc):
    """Return (meeting time, Teams link, agenda lines, number of agenda pages)."""
    lines = []
    agenda_pages = min(len(doc), MAX_AGENDA_PAGES)
    for i in range(min(len(doc), MAX_AGENDA_PAGES)):
        page_text_lines = page_lines(doc[i])
        lines.extend((i, x0, text) for x0, text in page_text_lines)
        if any(
            ADJOURN.search(t) and (HEADING_DIGIT.match(t.strip()) or HEADING_ROMAN.match(t.strip()))
            for _, t in page_text_lines
        ):
            agenda_pages = i + 1
            break
    else:
        agenda_pages = min(len(doc), 2)
        lines = [l for l in lines if l[0] < agenda_pages]

    meeting_time = None
    for _, _, text in lines:
        m = re.match(r"^\s*TIME\s*:\s*(.+)$", text, re.I)
        if m:
            meeting_time = _clean(m.group(1))
            break

    teams_link = None
    for i in range(agenda_pages):
        for link in doc[i].get_links():
            uri = link.get("uri") or ""
            if "teams.microsoft.com" in uri.lower() or "teams.live.com" in uri.lower():
                teams_link = uri
                break
        if teams_link:
            break
    return meeting_time, teams_link, lines, agenda_pages


def find_motion_items(lines):
    """Return (section found, list of (item number, title)) from the agenda lines."""
    start = None
    for idx, (_, _, text) in enumerate(lines):
        text = text.strip()
        for pattern, style in ((HEADING_DIGIT, "digit"), (HEADING_ROMAN, "roman")):
            m = pattern.match(text)
            if m and MOTION_TITLE.match(m.group(2)) and len(m.group(2)) < 60:
                start = (idx, style, m.group(1), MOTION_TITLE.match(m.group(2)).group(4))
                break
        if start:
            break
    if not start:
        return False, []

    idx, style, number, rest = start
    heading = HEADING_DIGIT if style == "digit" else HEADING_ROMAN
    body = [rest] if rest.strip() else []
    for _, _, text in lines[idx + 1:]:
        text = text.strip()
        if heading.match(text):
            break
        if PAGE_NOISE.match(text):
            continue
        body.append(text)

    if NOTHING.match(" ".join(body)):
        return True, []

    items, current = [], None
    for text in body:
        m = ITEM_MARK.match(text)
        if m and (current is None or len(m.group(1)) == 1):
            current = [m.group(1), [m.group(2)]]
            items.append(current)
        elif current is not None:
            current[1].append(text)
        else:
            current = ["", [text]]
            items.append(current)

    result = []
    for letter, parts in items:
        title = _clean(" ".join(parts))
        title = _clean(re.sub(r"^(board\s+)?motions?\s*:", "", title, flags=re.I))
        if not title or NOTHING.match(title):
            continue
        if style == "digit":
            item_number = f"{number}{letter.upper()}"
        else:
            item_number = f"{number}.{letter.lower()}" if letter else number
        result.append((item_number, title))
    return True, result


def core_title(title):
    """Return the subject of a motion without the district label and the date note."""
    quoted = re.search(r"[“\"]([^”\"]{8,})[”“\"]", title)
    if quoted:
        return quoted.group(1)
    return re.sub(r"^SD[\s-]?\d(\s*(and|&|/|,)\s*SD[\s-]?\d)*\s*[:•\-–]?\s*", "", title, flags=re.I)


def _squeeze(text):
    return re.sub(r"[\s_]+", " ", text).lower()


def find_backup(doc, title, first_page, taken):
    """Return (first page number, text) of the backup materials for one motion."""
    tokens = _tokens(core_title(title))
    if len(tokens) < 2:
        return None, ""

    def score(text):
        return sum(1 for t in tokens if t in text) / len(tokens)

    best = None
    for head_size, limit in ((900, 0.7), (3000, 0.8)):
        for i in range(first_page, len(doc)):
            if i in taken:
                continue
            head = _squeeze(doc[i].get_text())[:head_size]
            if len(head) >= 40 and score(head) >= limit:
                best = i
                break
        if best is not None:
            break
    if best is None:
        return None, ""

    parts, size = [], 0
    for i in range(best, min(len(doc), best + MAX_BACKUP_PAGES)):
        text = doc[i].get_text()
        if i > best:
            head = _squeeze(text)[:900]
            if NEW_DOCUMENT.search(text[:1500]) or ("agn. no" in head and score(head) < 0.6):
                break
            if len(text) < 700 and doc[i].get_images() and "motion by" not in head:
                break
        parts.append(text)
        size += len(text)
        if size >= MAX_BACKUP_CHARS or END_OF_MOTION.search(text):
            break
    return best + 1, "\n".join(parts)[:MAX_BACKUP_CHARS]


def parse_agenda(path):
    """Read one agenda PDF. Return a dictionary with all the data that we need."""
    doc = pymupdf.open(path)
    meeting_time, teams_link, lines, agenda_pages = read_front_matter(doc)
    section_found, items = find_motion_items(lines)
    motions, taken = [], set()
    for item_number, title in items:
        page, text = find_backup(doc, title, agenda_pages, taken)
        if page:
            taken.add(page - 1)
        motions.append(
            {"item_number": item_number, "title": title, "backup_page": page, "backup_text": text}
        )
    front_text = " ".join(t for _, _, t in lines)
    return {
        "pages": len(doc),
        "meeting_time": meeting_time,
        "teams_link": teams_link,
        "section_found": section_found,
        "says_cancelled": bool(re.search(r"\bCANCEL+ED\b", front_text, re.I)),
        "motions": motions,
    }
