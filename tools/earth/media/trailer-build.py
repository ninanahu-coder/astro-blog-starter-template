#!/usr/bin/env python3
"""地球人生概念预告片（docs/earth-game/aigc-media.md §6.6）：把 H3 三段转场和尖峰石阵穿行段拼成约 15 秒成片。
开头定格开始页，每段按 SPEED 加速，全程叠「AI 生成示意」角标，最后叠片名。
声音：各段 H3 原生音效（同样加速）垫底，上面铺 H3 生成的原创配乐 music.wav（没有就只用音效），整体归一到约 -16 LUFS。
用法：python3 tools/earth/media/trailer-build.py  （输入 tools/earth/media/h3/trailer/clips/seg1-3.mp4，输出同目录 out/trailer.mp4）"""
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent / 'h3'
T = ROOT / 'trailer'
OUT = T / 'out'; OUT.mkdir(exist_ok=True)
W, H, FPS = 1280, 720, 24
HOLD = 0.9          # 开始页定格秒数
SPEED = 1.5         # 每段加速倍数（5.17 s → 3.45 s）
TITLE_SEC = 2.2     # 片尾片名显示秒数
SEGS = [T / 'clips/seg1.mp4', T / 'clips/seg2.mp4', T / 'clips/seg3.mp4', ROOT / 'pinnacles-blend/clips/seg1.mp4']
FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'


def text_png(path, draw_fn):
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); draw_fn(ImageDraw.Draw(im)); im.save(path)


def tag(d):
    f = ImageFont.truetype(FONT, 16); s = 'AI 生成示意 · 概念预告，非实际游戏画面'
    w = d.textlength(s, font=f)
    d.rounded_rectangle((W - w - 44, H - 46, W - 16, H - 16), 8, fill=(0, 0, 0, 150))
    d.text((W - w - 30, H - 40), s, font=f, fill=(255, 255, 255, 235))


def title(d):
    f1 = ImageFont.truetype(FONT, 110); f2 = ImageFont.truetype(FONT, 34); f3 = ImageFont.truetype(FONT, 30)
    for s, f, y, sp in (('地球人生', f1, 230, 0), ('T E R R A   L I F E', f2, 372, 0), ('在真实的西澳和南澳过另一种人生', f3, 446, 0)):
        w = d.textlength(s, font=f); x = (W - w) / 2
        d.text((x + 3, y + 3), s, font=f, fill=(0, 0, 0, 170)); d.text((x, y), s, font=f, fill=(255, 244, 214, 255))


text_png(OUT / '_tag.png', tag); text_png(OUT / '_title.png', title)
dur = [float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(p)])) for p in SEGS]
total = HOLD + sum(d / SPEED for d in dur)
ins = ['-loop', '1', '-t', str(HOLD), '-i', str(T / 'kf/k1.png')]
for p in SEGS: ins += ['-i', str(p)]
ins += ['-loop', '1', '-t', str(total), '-i', str(OUT / '_tag.png'), '-loop', '1', '-t', str(total), '-i', str(OUT / '_title.png')]
norm = f'scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps={FPS},format=yuv420p,setsar=1'
fc = [f'[0:v]{norm}[v0]'] + [f'[{i + 1}:v]setpts=PTS/{SPEED},{norm}[v{i + 1}]' for i in range(len(SEGS))]
fc.append(''.join(f'[v{i}]' for i in range(len(SEGS) + 1)) + f'concat=n={len(SEGS) + 1}:v=1:a=0[cat]')
t0 = total - TITLE_SEC
# 声音：定格段补静音，各段原生音效同速加快后接起来；有配乐就压低音效混在一起
n = len(SEGS); music = T / 'music.wav'
fc.append(f'anullsrc=r=48000:cl=stereo,atrim=0:{HOLD}[a0]')
fc += [f'[{i + 1}:a]atempo={SPEED},aresample=48000,aformat=channel_layouts=stereo[a{i + 1}]' for i in range(n)]
fc.append(''.join(f'[a{i}]' for i in range(n + 1)) + f'concat=n={n + 1}:v=0:a=1,volume=0.5[sfx]')
if music.exists():
    ins += ['-i', str(music)]
    fc.append(f'[{n + 3}:a]atrim=0:{total:.2f},afade=t=in:d=0.3[mus];[sfx][mus]amix=inputs=2:normalize=0[mix]')
else:
    fc.append('[sfx]anull[mix]')
fc.append(f'[mix]loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=out:st={total - 0.8:.2f}:d=0.8[aout]')
fc.append(f'[{len(SEGS) + 2}:v]format=rgba,fade=t=in:st={t0:.2f}:d=0.6:alpha=1[ttl]')
fc.append(f'[cat][{len(SEGS) + 1}:v]overlay=0:0[a];[a][ttl]overlay=0:0:enable=\'gte(t,{t0:.2f})\',fade=t=out:st={total - 0.4:.2f}:d=0.4[out]')
dst = OUT / 'trailer.mp4'
subprocess.run(['ffmpeg', '-v', 'error', '-y', *ins, '-filter_complex', ';'.join(fc), '-map', '[out]', '-map', '[aout]', '-t', f'{total:.2f}', '-c:a', 'aac', '-b:a', '160k',
                '-c:v', 'libx264', '-profile:v', 'high', '-crf', '19', '-preset', 'slow', '-movflags', '+faststart', str(dst)], check=True)
print(f'{dst}  {total:.2f}s  {dst.stat().st_size} bytes')
