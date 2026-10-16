#!/usr/bin/env python
"""
Assembly step: beat audio + beat visual -> one MP4, with real audio.

Every segment's length is its narration's exact length, so the picture cannot
drift from the voice. Motion is a slow camera drift over the still (a crop whose
x offset is a function of time) rather than a zoom, because a drifting crop is
deterministic, encodes fast, and never fights the loop demuxer the way zoompan
does when it is fed an endless stream of identical frames.

  ffmpeg is imageio-ffmpeg's bundled binary, so the machine needs no install.
"""
import json
import pathlib
import subprocess
import sys

import imageio_ffmpeg

ROOT = pathlib.Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
SHOTS = ROOT / "shots"
AUDIO = ROOT / "audio"
SEGMENTS = BUILD / "segments"
SEGMENTS.mkdir(parents=True, exist_ok=True)

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
W, H, FPS = 1920, 1080, 30
DRIFT = 0.02  # 2% of the frame width, over the whole segment: a camera move, not a slideshow


def run(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", *args], capture_output=True, text=True)


def build_segment(beat: dict) -> pathlib.Path:
    image = SHOTS / f"{beat['id']}.png"
    audio = AUDIO / f"{beat['id']}.mp3"
    out = SEGMENTS / f"{beat['id']}.mp4"
    if not image.exists():
        raise SystemExit(f"missing visual for beat {beat['id']}: {image}")
    if not audio.exists():
        raise SystemExit(f"missing narration for beat {beat['id']}: {audio}")
    if out.exists() and out.stat().st_size > 50_000:
        print(f"  kept {beat['id']} segment")
        return out

    seconds = float(beat["seconds"])
    fade_out = max(seconds - 0.6, 0.1)
    # Upscale first, then drift a 1920x1080 window across it: the picture moves
    # without ever revealing an edge.
    drift_x = f"(in_w-{W})*min(t/{seconds:.3f},1)"

    video = (
        f"[0:v]scale={int(W * 1.06)}:-2,"
        f"crop={W}:{H}:x='{drift_x}':y='(in_h-{H})/2',"
        f"fade=t=in:st=0:d=0.45,fade=t=out:st={fade_out:.2f}:d=0.5,"
        f"fps={FPS},format=yuv420p[v]"
    )
    sound = f"[1:a]afade=t=in:st=0:d=0.2,afade=t=out:st={fade_out:.2f}:d=0.5[a]"

    result = run(
        [
            "-y",
            "-loop", "1", "-i", str(image),
            "-i", str(audio),
            "-filter_complex", f"{video};{sound}",
            "-map", "[v]", "-map", "[a]",
            "-t", f"{seconds:.3f}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
            "-movflags", "+faststart",
            str(out),
        ]
    )
    if result.returncode != 0 or not out.exists():
        print(result.stderr[-2000:], file=sys.stderr)
        raise SystemExit(f"ffmpeg failed for {beat['id']}")
    print(f"  built {beat['id']}  {seconds:6.1f}s  {beat['chapterTitle']}")
    return out


def main() -> int:
    beats = json.loads((BUILD / "audio.json").read_text(encoding="utf-8"))
    print(f"assembling {len(beats)} beats")

    segments = [build_segment(beat) for beat in beats]

    listing = BUILD / "concat.txt"
    listing.write_text("".join(f"file '{segment.as_posix()}'\n" for segment in segments), encoding="utf-8")

    final = ROOT / "begfi-explainer.mp4"
    result = run(
        [
            "-y",
            "-f", "concat", "-safe", "0", "-i", str(listing),
            "-c", "copy", "-movflags", "+faststart",
            str(final),
        ]
    )
    if result.returncode != 0:
        print(result.stderr[-2000:], file=sys.stderr)
        return 1

    total = sum(float(beat["seconds"]) for beat in beats)
    print(f"\nfinal: {final}  ({total / 60:.1f} minutes of narration)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
