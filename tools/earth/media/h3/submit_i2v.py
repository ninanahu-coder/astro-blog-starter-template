#!/usr/bin/env python3
"""地点推镜短片（纯 I2VA，只给首帧，不钉尾帧）：和 submit.py 的首尾同帧循环版做对比用。
为什么另写：h3v2 只会提交 FL2VA；钉尾帧（首=尾）再在提示词里写推镜会「推近再硬拉回」（库 shot-grammar R-H04 的 GPU 实测），
推镜只能走单首帧。图沿用 h3v2 的 FL2VA 模板，删掉尾帧节点（119/120/122、last_frame），和 ~/AI/video-workflow/bench_h3.py 一致。
用法：在 tools/earth/media/h3/<地点>-push/ 里（放好 config.env、kf/first.png、prompt.txt）
  python3 ../submit_i2v.py submit --seed 7701 [--dry-run]
  python3 ../submit_i2v.py poll"""
import argparse, json, sys, tempfile, os, time, uuid
from pathlib import Path
sys.path.insert(0, str(Path.home() / 'AI/video-workflow/dist/h3v2-workflow/scripts'))
import h3v2  # noqa: E402  （导入时读当前目录的 config.env）
import h3prompt  # noqa: E402

SEC = h3v2.snap_sec(5)


def submit(a):
    proj = Path.cwd()
    prompt = (proj / 'prompt.txt').read_text(encoding='utf-8').strip()
    _, iss = h3prompt.lint_text(prompt, 'i2va', SEC, 1)
    for x in iss: print(' ', x)
    if any(x['level'] == 'error' for x in iss): h3v2.die('提示词没过 h3prompt 门禁')
    if a.dry_run: print(f'[dry] {SEC:.3f}s 门禁通过'); return
    g = json.loads(h3v2.TEMPLATE.read_text())
    for nid in ('119', '120', '122'): g.pop(nid, None)
    g['105:104']['inputs'].pop('last_frame', None)
    g['105:104']['inputs']['prompt'] = prompt
    g['105:111']['inputs']['value'] = float(SEC)
    g['115']['inputs']['aspect_ratio'] = h3v2.aspect_ratio(h3v2.W, h3v2.H)
    g['105:17']['inputs']['sampler_name'] = 'res_multistep'
    g['105:15']['inputs']['noise_seed'] = a.seed
    g['92']['inputs']['filename_prefix'] = f'video/h3v2/earth_{proj.name}'
    tmp = Path(tempfile.mkdtemp())
    g['121']['inputs']['image'] = h3v2.upload_unique(h3v2.prep_frame(proj / 'kf/first.png', tmp / 'a.png'), 'earthloc')
    tf = tmp / 'g.json'; tf.write_text(json.dumps({'prompt': g, 'client_id': uuid.uuid4().hex}))
    out = h3v2.curl('/prompt', ['-H', 'Content-Type: application/json', '--data-binary', '@' + str(tf)])
    try: pid = json.loads(out)['prompt_id']
    except Exception: h3v2.die('提交失败: ' + out[:300])
    json.dump({'seg1': pid}, open(proj / 'queue.json', 'w'))
    (proj / '_prompts').mkdir(exist_ok=True)
    (proj / '_prompts/seg1.submitted.txt').write_text(prompt, encoding='utf-8')
    (proj / '_prompts/submitted.json').write_text(json.dumps({'seg1': {'prompt_id': pid, 'sec': round(SEC, 3), 'mode': 'i2va', 'seed': a.seed, 'time': time.strftime('%Y-%m-%d %H:%M:%S')}}, indent=1))
    (proj / 'clips/seg1.mp4').unlink(missing_ok=True)
    print(f'{proj.name} → {pid}')


p = argparse.ArgumentParser()
p.add_argument('cmd', choices=['submit', 'poll'])
p.add_argument('--seed', type=int, default=7701)
p.add_argument('--dry-run', action='store_true')
p.add_argument('--interval', type=int, default=30)
a = p.parse_args()
if a.cmd == 'submit': submit(a)
else:
    a.spec = str(Path.cwd() / 'prompt.txt'); h3v2.cmd_poll(a)
