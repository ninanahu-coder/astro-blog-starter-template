#!/usr/bin/env python3
"""量每段地点短片的封面和成片首帧差多少，写进 clips-qa.json 的 poster_diff。

封面由 encode-clips.py 从成片首帧截出，差值应当只剩 WebP 压缩误差（约 2）。
差值大说明封面和短片不是同一个画面，开播时会跳一下。

用法：python3 tools/earth/media/qa-posters.py
"""
import json, subprocess, sys
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
LOC = ROOT / 'public/earth/media/loc'
QA = ROOT / 'tools/earth/media/clips-qa.json'


def first_frame(mp4):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(mp4), '-frames:v', '1', '-vf', 'scale=320:180,format=gray',
                          '-f', 'rawvideo', '-'], check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).astype(np.float32)


def main():
    qa = json.loads(QA.read_text())
    bad = []
    for loc, rec in sorted(qa['clips'].items()):
        poster = np.asarray(Image.open(LOC / f'{loc}.webp').convert('L').resize((320, 180), Image.LANCZOS), np.float32).ravel()
        d = round(float(np.abs(first_frame(LOC / f'{loc}.mp4') - poster).mean()), 2)
        rec['poster_diff'] = d
        print(f'{loc:16s} {d}')
        if d >= 6:
            bad.append(loc)
    QA.write_text(json.dumps(qa, ensure_ascii=False, indent=2) + '\n')
    if bad:
        sys.exit('封面和成片首帧对不上：' + '、'.join(bad))


if __name__ == '__main__':
    main()
