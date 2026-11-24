#!/usr/bin/env python3
"""把远程 H3 出的地点短片压成网页用的小文件，并写进 public/earth/media/manifest.json。
用法：python3 tools/earth/media/encode-clips.py perth karijini busselton
     python3 tools/earth/media/encode-clips.py --once perth@perth-push   （只播一次的推镜版：不做循环淡化，清单写 once: true）
     python3 tools/earth/media/encode-clips.py --posters-only        （不重压，只把清单里每段的封面换成成片第一帧）
封面一律是成片第一帧（public/earth/media/loc/<地点>.webp），不再用静态图（比例不同，开播会跳）。
输入 tools/earth/media/h3/<地点或 @ 后的目录>/clips/seg1.mp4（h3v2 poll 下载的原片，不进仓库）；
输出 public/earth/media/loc/<地点>.mp4：H.264 640×360、24fps、去掉音轨（页面上静音循环播放）、首尾 0.5 秒交叉淡化成无缝循环、faststart，单个 ≤ 1MB。
另抽 6 张等距帧拼成 tools/earth/media/h3/<地点>/contact.jpg 供逐帧目检（不进仓库）。"""
import json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
H3 = ROOT / 'tools/earth/media/h3'
OUT = ROOT / 'public/earth/media/loc'
MANIFEST = ROOT / 'public/earth/media/manifest.json'
MAX = 1_000_000

def run(cmd): subprocess.run(cmd, check=True, capture_output=True)

def write_poster(loc):
    """从 public 里的成片取第一帧存成 <地点>.webp（本机 ffmpeg 没编 libwebp，取 PNG 帧后用 Pillow 存）"""
    import io
    from PIL import Image
    png = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(OUT / f'{loc}.mp4'), '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], check=True, capture_output=True).stdout
    Image.open(io.BytesIO(png)).convert('RGB').save(OUT / f'{loc}.webp', 'WEBP', quality=82, method=6)
    return f'/earth/media/loc/{loc}.webp'


def posters_only():
    """不重新压片，只把清单里每段短片的封面换成它自己的第一帧"""
    m = json.loads(MANIFEST.read_text())
    for loc, c in m['loc'].items():
        c['poster'] = write_poster(loc); print(f'✓ {loc} 封面 {(OUT / (loc + ".webp")).stat().st_size / 1000:.0f}KB')
    MANIFEST.write_text(json.dumps(m, ensure_ascii=False, indent='\t') + '\n')


def main(args):
    if '--posters-only' in args: return posters_only()
    once = '--once' in args
    locs = [x for x in args if not x.startswith('--')]
    OUT.mkdir(parents=True, exist_ok=True)
    m = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {'note': 'AI 生成示意内容（视频：远程 ComfyUI MiniMax H3；语音：MiniMax TTS），不是实拍、不是真人录音。', 'loc': {}, 'voice': {}}
    for arg in locs:
        loc, _, d = arg.partition('@'); d = d or loc
        src = H3 / d / 'clips/seg1.mp4'
        if not src.exists(): sys.exit(f'{loc}: 缺原片 {src}')
        dst = OUT / f'{loc}.mp4'
        L = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(src)], capture_output=True, text=True).stdout)
        # 循环缝：首尾关键帧相同，但 H3 出片尾帧和首帧仍差约 2（相邻帧约 0.2），循环时会跳一下。
        # 把开头 0.5 秒交叉淡入到结尾：输出 = 原片 0.5 秒之后的部分，最后 0.5 秒渐变成原片开头 0.5 秒，结尾正好接回输出开头。
        X = 0.5
        # 开头多留 1 帧：淡化结束后这一帧完整显示（xfade 最后一帧还是混合帧），下一帧就是输出开头（原片第 13 帧）
        F = 1 / 24; H = X + F
        loop = (f'[0:v]scale=640:360:flags=lanczos,fps=24,format=yuv420p,split[a][b];[a]trim=start={H:.4f},setpts=PTS-STARTPTS[body];'
                f'[b]trim=end={H:.4f},setpts=PTS-STARTPTS[head];[body][head]xfade=transition=fade:duration={X}:offset={L - H - X:.4f},format=yuv420p[v]')
        if once: loop = '[0:v]scale=640:360:flags=lanczos,fps=24,format=yuv420p[v]'   # 播一次停在末帧：整段原样压
        for crf in (22, 25, 28, 31, 34, 37):
            run(['ffmpeg', '-y', '-v', 'error', '-i', str(src), '-an', '-filter_complex', loop, '-map', '[v]',
                 '-c:v', 'libx264', '-preset', 'slow', '-crf', str(crf), '-profile:v', 'main', '-movflags', '+faststart', str(dst)])
            if dst.stat().st_size <= MAX * 0.9: break
        size = dst.stat().st_size
        if size > MAX: sys.exit(f'{loc}: 压到 crf 37 仍有 {size} 字节')
        dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(dst)], capture_output=True, text=True).stdout)
        run(['ffmpeg', '-y', '-v', 'error', '-i', str(src), '-vf', f'fps=6/{dur:.3f},scale=480:-2,tile=2x3', '-frames:v', '1', str(H3 / d / 'contact.jpg')])
        # 封面一律用成片自己的第一帧：静态图多是 2:1，短片是 16:9（裁掉两边），直接拿静态图当封面开播时画面会跳一下（§6.7）
        poster = write_poster(loc)
        m['loc'][loc] = {'src': f'/earth/media/loc/{loc}.mp4', 'poster': poster, **({'once': True} if once else {})}
        print(f'✓ {loc}{" (once)" if once else ""} {size / 1000:.0f}KB crf{crf} {dur:.2f}s')
    m['loc'] = dict(sorted(m['loc'].items())); m['voice'] = dict(sorted(m.get('voice', {}).items()))
    MANIFEST.write_text(json.dumps(m, ensure_ascii=False, indent='\t') + '\n')

if __name__ == '__main__': main(sys.argv[1:])
