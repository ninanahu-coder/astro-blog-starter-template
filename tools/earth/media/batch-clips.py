#!/usr/bin/env python3
"""地点短片批量生成（docs/earth-game/aigc-media.md §6.7）：按 h3/batch*.json 里的分镜，一个地点一个地点顺序跑。
每个地点：纯 I2VA 推镜（种子 7701）→ 测量 → 不过换 8802 再来一次 → 还不过改首尾同帧循环版（种子 7700）。
过线标准和 tests/earth/media.test.ts 一致：推镜要推近 ≥ ×1.04、不回弹、单调；循环要有东西在动、接缝不明显。
过了才压片进 public、写清单和 clips-qa.json；不过的只记在 h3/batch-log.jsonl，不进清单。
提交或下载出错就整批停下（不循环重试）。密抽帧接触印样留在各目录的 contact.jpg，仍需人眼逐张看过（变形、多出来的人、文字）。
用法：python3 tools/earth/media/batch-clips.py tools/earth/media/h3/batch3.json [--prepare] [--only loc1,loc2]
  --prepare 只建目录、首帧和提示词并过门禁，不提交"""
import json, shutil, subprocess, sys, time
from pathlib import Path
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
H3 = HERE / 'h3'; ROOT = HERE.parents[2]
RAW = Path.home() / 'earth-game/tools/earth/comfyui/.raw'   # 静态图的原始大图（不在仓库里）
QA = HERE / 'clips-qa.json'; LOG = H3 / 'batch-log.jsonl'
PUSH_SEEDS = (7701, 8802); LOOP_SEED = 7700
W, H = 1280, 720


def sh(cmd, cwd=None, timeout=2400):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    if r.returncode: sys.exit(f'命令失败，整批停下：{" ".join(map(str, cmd))}\n{(r.stdout + r.stderr)[-800:]}')
    return r.stdout


def first_frame(loc, dst):
    im = Image.open(RAW / f'{loc}.png').convert('RGB'); w, h = im.size; cw = round(h * 16 / 9)
    if cw <= w: im = im.crop(((w - cw) // 2, 0, (w - cw) // 2 + cw, h))
    else: ch = round(w * 9 / 16); im = im.crop((0, (h - ch) // 2, w, (h - ch) // 2 + ch))
    dst.parent.mkdir(parents=True, exist_ok=True); im.resize((W, H), Image.LANCZOS).save(dst)


def prepare(s):
    loc = s['loc']; push = H3 / f'{loc}-push'; loop = H3 / loc
    for d in (push, loop):
        first_frame(loc, d / 'kf/first.png'); shutil.copy(H3 / 'perth-push/config.env', d / 'config.env')
    (push / 'prompt.txt').write_text(
        'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n\n'
        f"integrated_multimodal_description: [Shot 1] Photorealistic {s['scene']}, with the {s['keep']} and the composition shown in <Picture 1> preserved. "
        f"From the first frame {s['start']}. The camera pushes in with small amplitude at slow speed toward {s['push_to']} and comes to rest on a slightly tighter wide shot of {s['rest']} in the final second. "
        f"{s['motion']}, and {s['still']} stay still.\n\noverall_soundscape: {s['ambience']}; {s['sfx']}.\n\nnon_diegetic_music: N/A\n", encoding='utf-8')
    (loop / 'segments.json').write_text(json.dumps({
        'style': f"Photorealistic {s['scene']}",
        'continuity': 'the framing, horizon and every landmark remain fixed and the scene settles into the framing shown in Picture 2 at the end of the shot, matching the first frame so the clip can loop.',
        'ambience': s['ambience'],
        'segments': [{'first': 'kf/first.png', 'last': 'kf/first.png', 'sec': 5, 'camera': 'The camera holds a locked-off static wide shot.',
                      'action': f"{s['start'][0].upper() + s['start'][1:]} throughout the shot. {s['motion']}. {s['still'][0].upper() + s['still'][1:]} stay still.", 'sfx': s['sfx']}]}, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    sh([sys.executable, '../submit_i2v.py', 'submit', '--dry-run'], cwd=push)
    sh([sys.executable, '../submit.py', 'segments.json', '--dry-run'], cwd=loop)


def measure(d):
    return json.loads(sh([sys.executable, str(HERE / 'qa-clip.py'), 'clips/seg1.mp4', 'kf/first.png', 'contact.jpg'], cwd=d).strip().splitlines()[-1])


def gray(path, w=320, h=180):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-vf', f'scale={w}:{h},format=gray', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(r, np.uint8).reshape(-1, h, w).astype(np.float32)


def log(**kw):
    with open(LOG, 'a', encoding='utf-8') as f: f.write(json.dumps({'time': time.strftime('%Y-%m-%d %H:%M:%S'), **kw}, ensure_ascii=False) + '\n')
    print(json.dumps(kw, ensure_ascii=False), flush=True)


def record(loc, entry):
    q = json.loads(QA.read_text()); q['clips'][loc] = entry; q['clips'] = dict(sorted(q['clips'].items()))
    QA.write_text(json.dumps(q, ensure_ascii=False, indent=1) + '\n')


def run(s):
    loc = s['loc']; push = H3 / f'{loc}-push'; loop = H3 / loc; tried = []
    for seed in PUSH_SEEDS:
        sh([sys.executable, '../submit_i2v.py', 'submit', '--seed', str(seed)], cwd=push)
        sh([sys.executable, '../submit_i2v.py', 'poll'], cwd=push)
        m = measure(push); shutil.copy(push / 'clips/seg1.mp4', push / f'clips/seg1-s{seed}.mp4'); shutil.copy(push / 'contact.jpg', push / f'contact-s{seed}.jpg')
        ok = m['kf_diff'] < 10 and m['scale_end'] >= 1.04 and m['rebound'] <= 0.01 and m['monotonic']
        tried.append(f"{seed} ×{m['scale_end']}"); log(loc=loc, mode='push', seed=seed, ok=ok, **{k: m[k] for k in ('kf_diff', 'motion_median', 'motion_max', 'scale_end', 'scale_peak', 'rebound', 'monotonic')})
        if ok:
            sh([sys.executable, str(HERE / 'encode-clips.py'), '--once', f'{loc}@{loc}-push'])
            m.pop('scale_curve', None); m.pop('loop_seam', None)
            record(loc, {'mode': 'once', 'source': f'{loc}-push', 'seed': str(seed), 'bytes': (ROOT / f'public/earth/media/loc/{loc}.mp4').stat().st_size, **m, 'pass': True, 'eyeball': 'pending'})
            return
    sh([sys.executable, '../submit.py', 'segments.json', '--seed', str(LOOP_SEED)], cwd=loop)
    sh([sys.executable, str(Path.home() / 'AI/video-workflow/dist/h3v2-workflow/scripts/h3v2.py'), 'poll', 'segments.json'], cwd=loop)
    m = measure(loop); m.pop('scale_curve', None); m.pop('loop_seam', None)
    sh([sys.executable, str(HERE / 'encode-clips.py'), loc])
    dst = ROOT / f'public/earth/media/loc/{loc}.mp4'; v = gray(dst); adj = np.abs(np.diff(v, axis=0)).mean(axis=(1, 2))
    seam = float(np.abs(v[-1] - v[0]).mean()); mx = float(adj.max())
    ok = m['kf_diff'] < 10 and m['motion_median'] >= 0.08 and seam <= 3 * mx
    log(loc=loc, mode='loop', seed=LOOP_SEED, ok=ok, kf_diff=m['kf_diff'], motion_median=m['motion_median'], web_loop_seam=round(seam, 2), web_max_adjacent=round(mx, 2))
    if ok:
        record(loc, {'mode': 'loop', 'source': loc, 'seed': f'loop {LOOP_SEED}（推镜 {"、".join(tried)} 未过）', 'bytes': dst.stat().st_size, **m, 'pass': True,
                     'web_frames': int(len(v)), 'web_loop_seam': round(seam, 2), 'web_max_adjacent': round(mx, 2), 'eyeball': 'pending'})
    else:   # 不过线：撤掉刚写进 public 和清单的东西
        dst.unlink(missing_ok=True); (dst.with_suffix('.webp')).unlink(missing_ok=True)
        mf = ROOT / 'public/earth/media/manifest.json'; j = json.loads(mf.read_text()); j['loc'].pop(loc, None); mf.write_text(json.dumps(j, ensure_ascii=False, indent='\t') + '\n')


if __name__ == '__main__':
    args = sys.argv[1:]; spec = json.loads(Path(args[0]).read_text())['locs']
    only = next((a.split('=', 1)[1].split(',') for a in args if a.startswith('--only=')), None)
    todo = [s for s in spec if not only or s['loc'] in only]
    for s in todo: prepare(s)
    print(f'已准备 {len(todo)} 个地点，门禁通过', flush=True)
    if '--prepare' in args: sys.exit(0)
    done = set(json.loads(QA.read_text())['clips'])
    for s in todo:
        if s['loc'] in done: print(f"跳过 {s['loc']}（已有验收记录）", flush=True); continue
        run(s)
    print('整批结束', flush=True)
