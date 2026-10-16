#!/usr/bin/env python
"""
Narration: one audio clip per BEAT (chapters.json), so a beat's audio length IS
the on-screen length of its visual. No proportional guessing, no drift.

Voice: edge-tts (Microsoft's online neural voices). It is a network call; if it
fails the script says so and writes nothing, rather than producing a video with
missing narration.
"""
import asyncio
import json
import pathlib
import subprocess
import sys

import edge_tts
import imageio_ffmpeg

ROOT = pathlib.Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
AUDIO = ROOT / "audio"
BUILD.mkdir(exist_ok=True)
AUDIO.mkdir(exist_ok=True)

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
chapters = json.loads((ROOT / "chapters.json").read_text(encoding="utf-8"))


def duration(path: pathlib.Path) -> float:
    out = subprocess.run(
        [FFMPEG, "-i", str(path), "-f", "null", "-"],
        capture_output=True,
        text=True,
    ).stderr
    for line in out.splitlines():
        if "Duration:" in line:
            stamp = line.split("Duration:")[1].split(",")[0].strip()
            hours, minutes, seconds = stamp.split(":")
            return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    raise RuntimeError(f"no duration for {path}")


async def main() -> int:
    beats = []
    for chapter in chapters["chapters"]:
        for index, beat in enumerate(chapter["beats"], start=1):
            beats.append(
                {
                    "id": f"{chapter['id']}-{index}",
                    "chapter": chapter["id"],
                    "chapterTitle": chapter["title"],
                    "text": beat["text"],
                    "card": beat.get("card"),
                    "page": beat.get("page"),
                    "scroll": beat.get("scroll", 0.0),
                    "zoom": beat.get("zoom"),
                }
            )

    for beat in beats:
        path = AUDIO / f"{beat['id']}.mp3"
        if path.exists() and path.stat().st_size > 2000:
            beat["seconds"] = round(duration(path), 3)
            print(f"  kept {beat['id']} ({beat['seconds']}s)")
            continue
        communicate = edge_tts.Communicate(beat["text"], chapters["voice"], rate=chapters["rate"])
        await communicate.save(str(path))
        if not path.exists() or path.stat().st_size < 1000:
            print(f"FAILED to synthesise {beat['id']}", file=sys.stderr)
            return 1
        beat["seconds"] = round(duration(path), 3)
        print(f"  tts  {beat['id']} ({beat['seconds']}s)")

    total = sum(beat["seconds"] for beat in beats)
    (BUILD / "audio.json").write_text(json.dumps(beats, indent=2), encoding="utf-8")
    print(f"\n{len(beats)} beats, {total / 60:.1f} minutes of narration")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
