#!/usr/bin/env python3
"""地点短片验收测量（见 docs/earth-game/aigc-media.md §6.3/§6.4）：
- 首帧 vs 关键帧灰度差（共享服务器串帧时是 50–70，正常 3–6）
- 运动量：相邻帧灰度差中位 / 最大
- 推近比例：每帧对首帧做中心裁切放大的尺度搜索（1.00–1.40），报最大值、末帧值、回弹（最大 − 末帧）、单调性
- 循环缝：末帧 vs 首帧，和片内最大相邻差比
- 密抽帧：每 6 帧一张（5 秒约 21 张）拼成 7 列接触印样，供目检变形 / 多出来的东西 / 文字 / 人
用法：python3 tools/earth/media/qa-clip.py <clip.mp4> <kf.png> <contact.jpg>  （输出一行 JSON）"""
import json, subprocess, sys
import numpy as np
from PIL import Image

clip, kf, contact = sys.argv[1:4]
W, H = 320, 180
r = subprocess.run(['ffmpeg', '-v', 'error', '-i', clip, '-vf', f'scale={W}:{H},format=gray', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], capture_output=True, check=True)
a = np.frombuffer(r.stdout, np.uint8); n = len(a) // (W * H)
v = a[:n * W * H].reshape(n, H, W).astype(np.float32)
k = np.asarray(Image.open(kf).convert('L').resize((W, H), Image.LANCZOS), np.float32)
d = np.abs(np.diff(v, axis=0)).mean(axis=(1, 2))
im0 = Image.fromarray(v[0].astype(np.uint8))


def scale_of(f):
    best = (1e9, 1.0)
    for s in np.arange(1.0, 1.401, 0.005):
        cw, ch = W / s, H / s
        c = im0.crop(((W - cw) / 2, (H - ch) / 2, (W + cw) / 2, (H + ch) / 2)).resize((W, H), Image.BILINEAR)
        m = np.abs(np.asarray(c, np.float32)[10:-10, 10:-10] - f[10:-10, 10:-10]).mean()
        if m < best[0]: best = (m, s)
    return best[1]


idx = list(range(0, n, 6)) + ([n - 1] if (n - 1) % 6 else [])
sc = [scale_of(v[i]) for i in idx]
peak = max(sc); end = sc[-1]
mono = all(b >= a - 0.006 for a, b in zip(sc, sc[1:]))
out = {
    'frames': n, 'sec': round(n / 24, 2),
    'kf_diff': round(float(np.abs(v[0] - k).mean()), 2),
    'motion_median': round(float(np.median(d)), 2), 'motion_max': round(float(d.max()), 2),
    'scale_end': round(end, 3), 'scale_peak': round(peak, 3), 'rebound': round(peak - end, 3), 'monotonic': mono,
    'loop_seam': round(float(np.abs(v[-1] - v[0]).mean()), 2),
    'scale_curve': [round(s, 3) for s in sc],
}
# 密抽帧接触印样（原分辨率取帧再缩到 320 宽，7 列）
sel = '+'.join(f'eq(n\\,{i})' for i in idx)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', clip, '-vf', f"select='{sel}',scale=320:-2,tile=7x{(len(idx) + 6) // 7}", '-fps_mode', 'passthrough', '-frames:v', '1', contact], check=True)
print(json.dumps(out, ensure_ascii=False))
