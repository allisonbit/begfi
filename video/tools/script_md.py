#!/usr/bin/env python
"""
Emits SCRIPT.md: the narration as a readable document, with each beat's exact
duration and the visual it plays over. Run after tts.py so the timings exist.
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
chapters = json.loads((ROOT / "chapters.json").read_text(encoding="utf-8"))
beats = {beat["id"]: beat for beat in json.loads((ROOT / "build" / "audio.json").read_text(encoding="utf-8"))}

lines = [
    f"# {chapters['title']} — narration script",
    "",
    f"Voice `{chapters['voice']}`, rate `{chapters['rate']}`. Each beat is one audio clip and one",
    "visual, so a beat's length is its own narration's length.",
    "",
]

def stamp(seconds: float) -> str:
    """Minutes:seconds, floored — rounding the minutes would print 1:33 for 33.8s."""
    return f"{int(seconds // 60)}:{seconds % 60:04.1f}"


elapsed = 0.0
for chapter in chapters["chapters"]:
    duration = sum(beats[f"{chapter['id']}-{i}"]["seconds"] for i in range(1, len(chapter["beats"]) + 1))
    start = elapsed
    elapsed += duration
    lines += [f"## {chapter['id']} — {chapter['title']}", "", f"*{stamp(start)} – {stamp(elapsed)} · {duration:.1f}s*", ""]
    for index, beat in enumerate(chapter["beats"], start=1):
        measured = beats[f"{chapter['id']}-{index}"]
        if beat.get("card"):
            visual = f"card: {beat['card']['title']}"
        else:
            visual = f"page: {beat['page']}"
        lines += [f"**{chapter['id']}.{index}** · {measured['seconds']:.1f}s · *{visual}*", "", beat["text"], ""]

lines += [f"**Total narration: {elapsed/60:.1f} minutes across {len(beats)} beats.**", ""]
out = ROOT / "SCRIPT.md"
out.write_text("\n".join(lines), encoding="utf-8")
print(f"wrote {out} — {elapsed/60:.1f} minutes")
