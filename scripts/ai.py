"""Calls to the Claude AI model.

The AI does two tasks only:
1. It writes a brief summary of one motion from the motion text.
2. It counts the motions on the first pages of an agenda. This is a second
   check on the fixed rules of the agenda reader.

The key for the AI service is in the GitHub secret ANTHROPIC_API_KEY.
Without the key, the tracker operates without these two tasks.
"""
import os
from typing import List, Optional

import anthropic
from pydantic import BaseModel

MODEL = "claude-opus-5-5"

SUMMARY_RULES = """You write very brief summaries of Los Angeles County Board of Supervisors motions for a public tracker.

You receive the title of one motion and the text of the motion.
Write one or two short sentences, with a maximum of 60 words in total.
State what the motion directs or approves. Include the most important amount of money, deadline, or responsible department when the text gives one.
Use plain language. Use only facts from the text. Do not start with "This motion".
If the text is not readable or is not a motion, return no summary."""

CHECK_RULES = """You check the first pages of a Los Angeles County cluster meeting agenda.

Find the section for motions of the Board of Supervisors. Its heading is, for example, "BOARD MOTION ITEM(S)", "Board Motion", or "Motion(s)".
List the title of each motion in that section only.
Do not list Board Letters, informational items, presentation items, discussion items, or closed session items.
If the section is absent, or says "None" or "No items", return an empty list."""


class Summary(BaseModel):
    summary: Optional[str]


class MotionList(BaseModel):
    motion_titles: List[str]


def available():
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _ask(rules, text, shape):
    client = anthropic.Anthropic(max_retries=4)
    response = client.messages.parse(
        model=MODEL,
        max_tokens=4000,
        system=rules,
        messages=[{"role": "user", "content": text}],
        output_config={"effort": "low"},
        output_format=shape,
    )
    if response.stop_reason == "refusal" or response.parsed_output is None:
        raise RuntimeError(f"The AI service gave no usable answer (stop reason: {response.stop_reason}).")
    return response.parsed_output


def summarize(title, motion_text):
    """Return a brief summary of one motion, or None if the text is not a motion."""
    summary = _ask(SUMMARY_RULES, f"Motion title: {title}\n\nMotion text:\n{motion_text}", Summary).summary
    return " ".join(summary.split()) if summary else None


def list_motions(agenda_front_text):
    """Return the motion titles that the AI finds on the first pages of an agenda."""
    return _ask(CHECK_RULES, agenda_front_text, MotionList).motion_titles
