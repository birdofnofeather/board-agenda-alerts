"""Find new cluster meeting agendas and save their Board Motion items.

Steps:
1. Get the list of agendas from the data feed of the county agenda page.
2. Download each agenda PDF that is new or that has a new file address.
3. Read the Board Motion section with fixed rules (see agenda_parser.py).
4. Ask the summary service for a brief summary of each motion.
5. Save all the data, with the motion text, in public/data/agendas.json.
   The website reads this file. The file history shows each change.

The job is safe to run again. It only does work for agendas that changed.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

from agenda_parser import parse_agenda

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = ROOT / "public" / "data" / "agendas.json"
FEED_URL = "https://ceo.lacounty.gov/wp-json/blade-child/v1/agenda-data"
BROWSER = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0 Safari/537.36"
)
CLUSTERS = {
    "OC": "operations",
    "CSC": "community_services",
    "FSSC": "family_social_services",
    "HMHSC": "health_mental_health",
}
PARSER_VERSION = 1
NO_AI = False
BRIEF = (
    "RULES FOR THE SUMMARY: Write one or two short sentences, with a maximum of 60 words in total. "
    "State what the motion directs or approves. Use plain language. Use only facts from the text. "
    'Do not start with "This motion".\n\nMOTION TEXT:\n'
)


def log(message):
    print(message, flush=True)


def read_env_file():
    """Read the address and the public key of the summary service from the .env file."""
    values = {}
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip().strip('"')
    return values


ENV = read_env_file()
SUPABASE_URL = (os.environ.get("SUPABASE_URL") or ENV.get("VITE_SUPABASE_URL", "")).rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or ENV.get("VITE_SUPABASE_PUBLISHABLE_KEY", "")
SUMMARY_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}


def get_with_retry(url, attempts=4, **kwargs):
    last_error = None
    for attempt in range(attempts):
        try:
            response = requests.get(url, headers={"User-Agent": BROWSER}, timeout=180, **kwargs)
            if response.status_code == 200:
                return response
            last_error = f"HTTP {response.status_code}"
        except requests.RequestException as error:
            last_error = str(error)
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"Could not download {url}: {last_error}")


def fetch_feed():
    """Return the newest agenda entry for each cluster and meeting date."""
    rows = get_with_retry(FEED_URL).json()
    if not isinstance(rows, list) or not rows:
        raise RuntimeError("The agenda data feed returned no entries.")
    newest = {}
    for row in rows:
        cluster = CLUSTERS.get(row.get("deptAbbrv"))
        if not cluster or not row.get("date") or not row.get("url"):
            continue
        entry = {
            "cluster": cluster,
            "date": row["date"],
            "url": row["url"],
            "label": row.get("title") or "Agenda",
            "document_id": int(re.sub(r"\D", "", str(row.get("documentId") or "0")) or 0),
        }
        key = f"{cluster}|{row['date']}"
        if key not in newest or entry["document_id"] > newest[key]["document_id"]:
            newest[key] = entry
    return newest


def download_pdf(url, folder, cache=None):
    if cache and (Path(cache) / url.rsplit("/", 1)[-1]).exists():
        return Path(cache) / url.rsplit("/", 1)[-1]
    response = get_with_retry(url)
    if not response.content.startswith(b"%PDF"):
        raise RuntimeError("The downloaded file is not a PDF. The county site possibly blocked the request.")
    path = Path(folder) / "agenda.pdf"
    path.write_bytes(response.content)
    return path


def summarize(title, text, cluster, date):
    """Ask the summary service for a brief summary of one motion."""
    if not text.strip():
        return None
    if not SUPABASE_URL or NO_AI:
        raise RuntimeError("The summary service is not set up.")
    body = {
        "title": title,
        "content": BRIEF + text,
        "content_type": "text",
        "meeting_info": {"cluster": cluster, "date": date},
    }
    last_error = None
    for attempt in range(3):
        try:
            response = requests.post(
                f"{SUPABASE_URL}/functions/v1/extract-motions", headers=SUMMARY_HEADERS, json=body, timeout=120
            )
            data = response.json()
            if response.status_code == 200 and data.get("success"):
                summary = data.get("summary")
                if summary is None and data.get("board_motions"):
                    summary = data["board_motions"][0].get("summary")
                if summary:
                    return re.sub(r"\s+", " ", summary).strip()
                last_error = "The summary service returned no summary."
            else:
                last_error = f"HTTP {response.status_code}: {str(data)[:200]}"
        except (requests.RequestException, ValueError) as error:
            last_error = str(error)
        time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"Summary failed: {last_error}")


def summary_from_text(text):
    """Return the first instruction of the motion. Use this when the summary service is not available."""
    match = re.search(r"THEREFORE,?\s+MOVE\s+(.{40,})", re.sub(r"\s+", " ", text), re.I)
    if not match:
        return None
    words = match.group(1).split(" ")
    extract = " ".join(words[:55])
    return "Moves " + extract + ("…" if len(words) > 55 else "")


def process(entry, previous, cache=None):
    """Download and read one agenda. Return the record for the archive."""
    with tempfile.TemporaryDirectory() as folder:
        parsed = parse_agenda(download_pdf(entry["url"], folder, cache))

    old_motions = {
        m["text_hash"]: m
        for m in (previous or {}).get("motions", [])
        if m.get("summary") and m.get("summary_source") == "ai"
    }
    motions = []
    for m in parsed["motions"]:
        text_hash = hashlib.sha256(m["backup_text"].encode()).hexdigest()[:16]
        if text_hash in old_motions and m["backup_text"]:
            summary, source = old_motions[text_hash]["summary"], "ai"
        else:
            try:
                summary, source = summarize(m["title"], m["backup_text"], entry["cluster"], entry["date"]), "ai"
            except RuntimeError as error:
                log(f"     {error}")
                summary, source = summary_from_text(m["backup_text"]), "text"
        motions.append(
            {
                "item_number": m["item_number"],
                "title": m["title"],
                "summary": summary,
                "summary_source": source,
                "backup_page": m["backup_page"],
                "text_hash": text_hash,
                "backup_text": m["backup_text"],
            }
        )

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    history = list((previous or {}).get("history", []))
    if previous and previous["url"] != entry["url"]:
        history.append(
            {
                "replaced_at": now,
                "url": previous["url"],
                "label": previous.get("label"),
                "motions": [
                    {k: m[k] for k in ("item_number", "title", "text_hash")} for m in previous["motions"]
                ],
            }
        )
    return {
        "cluster": entry["cluster"],
        "date": entry["date"],
        "url": entry["url"],
        "label": entry["label"],
        "pages": parsed["pages"],
        "meeting_time": parsed["meeting_time"],
        "teams_link": parsed["teams_link"],
        "is_cancelled": bool(re.search(r"cancel", entry["label"], re.I)) or parsed["says_cancelled"],
        "motion_section_found": parsed["section_found"],
        "motions": motions,
        "first_seen": (previous or {}).get("first_seen", now),
        "processed_at": now,
        "parser_version": PARSER_VERSION,
        "history": history,
    }


def write_archive(archive):
    ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
    ordered = dict(sorted(archive.items(), key=lambda kv: (kv[1]["date"], kv[1]["cluster"]), reverse=True))
    ARCHIVE.write_text(json.dumps(ordered, indent=1, ensure_ascii=False) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--extra-list", help="JSON file with more agendas: cluster, date, url, label")
    parser.add_argument("--limit", type=int, default=0, help="Maximum number of agendas to process")
    parser.add_argument("--pdf-cache", help="Folder with PDF files that are already downloaded")
    parser.add_argument("--no-ai", action="store_true", help="Do not call the summary service")
    args = parser.parse_args()
    global NO_AI
    NO_AI = args.no_ai

    archive = json.loads(ARCHIVE.read_text()) if ARCHIVE.exists() else {}
    entries = fetch_feed()
    if args.extra_list:
        for extra in json.loads(Path(args.extra_list).read_text()):
            entries.setdefault(f"{extra['cluster']}|{extra['date']}", {**extra, "document_id": 0})
    log(f"The feed lists {len(entries)} agendas for the four clusters.")

    def needs_work(key, entry):
        if key not in archive:
            return True
        old = archive[key]
        if old["url"] != entry["url"] or old.get("parser_version") != PARSER_VERSION:
            return True
        return any(m.get("summary_source") != "ai" for m in old["motions"])

    todo = [(k, e) for k, e in sorted(entries.items(), key=lambda kv: kv[1]["date"]) if needs_work(k, e)]
    if args.limit:
        todo = todo[: args.limit]
    log(f"{len(todo)} agendas are new, changed, or without a full summary.")

    errors, waiting = [], 0
    for key, entry in todo:
        try:
            record = process(entry, archive.get(key), args.pdf_cache)
            archive[key] = record
            write_archive(archive)
            waiting += sum(1 for m in record["motions"] if m["summary_source"] != "ai")
            log(f"OK   {entry['date']} {entry['cluster']}: {len(record['motions'])} motions")
        except Exception as error:  # Continue with the other agendas.
            errors.append(f"{entry['date']} {entry['cluster']}: {error}")
            log(f"FAIL {entry['date']} {entry['cluster']}: {error}")

    if waiting:
        log(f"\n{waiting} motions have a summary from the motion text only. The next run will try the summary service again.")
    if errors:
        log(f"\n{len(errors)} problems. The next run will try these again.")
        sys.exit(1)
    log("\nAll agendas are up to date.")


if __name__ == "__main__":
    main()
