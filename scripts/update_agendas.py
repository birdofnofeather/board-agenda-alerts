"""Find new cluster meeting agendas and save their Board Motion items.

Steps:
1. Get the list of agendas from the data feed of the county agenda page.
2. Download each agenda PDF that is new or that has a new file address.
3. Read the Board Motion section with fixed rules (see agenda_parser.py).
4. Ask the AI for a brief summary of each motion.
5. Ask the AI to count the motions, as a second check on the fixed rules.
6. Read the Board of Supervisors agendas and find each cluster motion on them.
7. Save all the data in public/data. The website reads these files.

The job does not stop when one agenda has a problem. It records each problem
in public/data/status.json and continues.

The job is safe to run again. It only does work for agendas that changed.
"""
import argparse
import hashlib
import json
import os
import re
import tempfile
import time
import traceback
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

import ai
import board_agendas
from agenda_parser import parse_agenda

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = ROOT / "public" / "data" / "agendas.json"
STATUS = ROOT / "public" / "data" / "status.json"
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


def log(message):
    print(message, flush=True)


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


def summary_from_text(text):
    """Return the first instruction of the motion. Use this when the summary service is not available."""
    match = re.search(r"THEREFORE,?\s+MOVE\s+(.{40,})", re.sub(r"\s+", " ", text), re.I)
    if not match:
        return None
    words = match.group(1).split(" ")
    extract = " ".join(words[:55])
    return "Moves " + extract + ("…" if len(words) > 55 else "")


def process(entry, previous, problems, cache=None):
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
        if not m["backup_text"].strip():
            summary, source = None, "none"
        elif text_hash in old_motions:
            summary, source = old_motions[text_hash]["summary"], "ai"
        elif ai.available():
            try:
                summary, source = ai.summarize(m["title"], m["backup_text"]), "ai"
            except Exception as error:
                problems.append(f"{entry['date']} {entry['cluster']}: the AI summary failed ({error}).")
                summary, source = summary_from_text(m["backup_text"]), "text"
        else:
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

    check = {"status": "not_checked"}
    if ai.available():
        try:
            titles = ai.list_motions(parsed["front_text"])
            check = {
                "status": "agree" if len(titles) == len(motions) else "differ",
                "ai_count": len(titles),
                "ai_titles": titles,
            }
        except Exception as error:
            problems.append(f"{entry['date']} {entry['cluster']}: the AI check failed ({error}).")

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
        "check": check,
        "first_seen": (previous or {}).get("first_seen", now),
        "processed_at": now,
        "parser_version": PARSER_VERSION,
        "history": history,
    }


def write_archive(archive):
    ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
    ordered = dict(sorted(archive.items(), key=lambda kv: (kv[1]["date"], kv[1]["cluster"]), reverse=True))
    ARCHIVE.write_text(json.dumps(ordered, indent=1, ensure_ascii=False) + "\n")


def run(args, problems):
    archive = json.loads(ARCHIVE.read_text()) if ARCHIVE.exists() else {}
    entries = fetch_feed()
    if args.extra_list:
        for extra in json.loads(Path(args.extra_list).read_text()):
            entries.setdefault(f"{extra['cluster']}|{extra['date']}", {**extra, "document_id": 0})
    log(f"The feed lists {len(entries)} agendas for the four clusters.")
    if not ai.available():
        log("The AI key is not set. New summaries come from the motion text, and the AI check does not run.")

    recent = (date.today() - timedelta(days=30)).isoformat()

    def needs_work(key, entry):
        if key not in archive:
            return True
        old = archive[key]
        if old["url"] != entry["url"] or old.get("parser_version") != PARSER_VERSION:
            return True
        if not ai.available():
            return False
        waits_for_summary = any(m.get("summary_source") == "text" for m in old["motions"])
        waits_for_check = old["date"] >= recent and old.get("check", {}).get("status", "not_checked") == "not_checked"
        return waits_for_summary or waits_for_check

    todo = [(k, e) for k, e in sorted(entries.items(), key=lambda kv: kv[1]["date"]) if needs_work(k, e)]
    if args.limit:
        todo = todo[: args.limit]
    log(f"{len(todo)} agendas need work.")

    for key, entry in todo:
        try:
            record = process(entry, archive.get(key), problems, args.pdf_cache)
            archive[key] = record
            write_archive(archive)
            log(f"OK   {entry['date']} {entry['cluster']}: {len(record['motions'])} motions, AI check: {record['check']['status']}")
        except Exception as error:  # Continue with the other agendas.
            problems.append(f"{entry['date']} {entry['cluster']}: the agenda was not read ({error}).")
            log(f"FAIL {entry['date']} {entry['cluster']}: {error}")

    for record in archive.values():
        if record.get("check", {}).get("status") == "differ" and record["date"] >= recent:
            problems.append(
                f"{record['date']} {record['cluster']}: the fixed rules found {len(record['motions'])} motions, "
                f"and the AI check found {record['check']['ai_count']}. Examine this agenda: {record['url']}"
            )

    try:
        board = board_agendas.update_board_file(get_with_retry, log)
        for record in archive.values():
            for motion in record["motions"]:
                motion["board"] = board_agendas.find_on_board(motion["title"], record["date"], board, date.today())
        write_archive(archive)
    except Exception as error:
        problems.append(f"The Board agendas were not read ({error}).")
        log(f"FAIL Board agendas: {error}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--extra-list", help="JSON file with more agendas: cluster, date, url, label")
    parser.add_argument("--limit", type=int, default=0, help="Maximum number of agendas to process")
    parser.add_argument("--pdf-cache", help="Folder with PDF files that are already downloaded")
    args = parser.parse_args()

    problems = []
    try:
        run(args, problems)
    except Exception as error:
        traceback.print_exc()
        problems.append(f"The job stopped before the end ({error}).")

    STATUS.parent.mkdir(parents=True, exist_ok=True)
    STATUS.write_text(
        json.dumps(
            {
                "last_run": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "ai_available": ai.available(),
                "problems": problems,
            },
            indent=1,
            ensure_ascii=False,
        )
        + "\n"
    )
    if os.environ.get("PROBLEMS_FILE"):
        Path(os.environ["PROBLEMS_FILE"]).write_text("".join(f"- {p}\n" for p in problems))
    log(f"\n{len(problems)} problems." if problems else "\nNo problems.")


if __name__ == "__main__":
    main()
