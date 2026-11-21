#!/usr/bin/env python3
"""体验改造 P3：给「省流量」画面档生成 1 倍配图。

public/earth/cgi/manifest.json 里的每张图缩到一半宽，存到 public/earth/cgi/1x/ 下同名文件。
原图是按手机 2 倍屏准备的（宽图 640–960、方图 256），省流量档换成 1 倍图，每张大约只有原来的四分之一。
用 cwebp 压（和原图同一个工具），质量 72、不带元数据。重跑会覆盖；清单里删掉的图，1x 目录里的旧文件也会删掉。

用法：python3 tools/earth/media/cgi-1x.py
"""
import json
import struct
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CGI = ROOT / 'public/earth/cgi'
OUT = CGI / '1x'


def webp_size(b: bytes):
    kind = b[12:16]
    if kind == b'VP8X':
        return 1 + int.from_bytes(b[24:27], 'little'), 1 + int.from_bytes(b[27:30], 'little')
    if kind == b'VP8 ':
        return struct.unpack('<H', b[26:28])[0] & 0x3FFF, struct.unpack('<H', b[28:30])[0] & 0x3FFF
    if kind == b'VP8L':
        v = struct.unpack('<I', b[21:25])[0]
        return (v & 0x3FFF) + 1, ((v >> 14) & 0x3FFF) + 1
    raise ValueError('不是 WebP')


def main():
    images = json.loads((CGI / 'manifest.json').read_text())['images']
    OUT.mkdir(exist_ok=True)
    keep = set()
    total_src = total_out = 0
    for url in sorted(set(images.values())):
        name = url.removeprefix('/earth/cgi/')
        src = CGI / name
        w, h = webp_size(src.read_bytes())
        dst = OUT / name
        keep.add(name)
        subprocess.run(['cwebp', '-quiet', '-q', '72', '-m', '6', '-metadata', 'none', '-resize', str(max(1, round(w / 2))), str(max(1, round(h / 2))), str(src), '-o', str(dst)], check=True)
        total_src += src.stat().st_size
        total_out += dst.stat().st_size
    for f in OUT.glob('*.webp'):
        if f.name not in keep:
            f.unlink()
    print(f'{len(keep)} 张：原图 {total_src / 1e6:.1f} MB → 1 倍图 {total_out / 1e6:.1f} MB')


if __name__ == '__main__':
    sys.exit(main())
