"""把 Blender 渲出来的 PNG 变成游戏和展示用的图片。
用法：python3 tools/earth/blender/export.py <渲染输出目录> [--public public/earth/char]

- 证件照（id 形如 出身-形象下标）：缩到 256×256、转成带透明通道的 WebP，写进 public/earth/char/，并生成 manifest.json。
- 全身照：在脚下画一块柔和的影子（渲染时背景透明、没有地面），写进 <输出目录>/show/，只给展示页用，不进游戏。
"""
import json
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFilter

BUST_SIZE = 256
INK = (24, 38, 63)  # 设计令牌里的墨色，影子用它而不是纯黑


def with_shadow(im, foot, unit):
	w, h = im.size
	cx, cy = foot[0] * w, (1 - foot[1]) * h  # 相机坐标的 y 从下往上
	rx = 0.30 * unit * w
	ry = rx * 0.20
	mask = Image.new('L', im.size, 0)
	ImageDraw.Draw(mask).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=110)
	mask = mask.filter(ImageFilter.GaussianBlur(rx * 0.20))
	shadow = Image.new('RGBA', im.size, INK + (0,))
	shadow.putalpha(mask)
	return Image.alpha_composite(shadow, im)


def main():
	src = sys.argv[1]
	public = sys.argv[sys.argv.index('--public') + 1] if '--public' in sys.argv else 'public/earth/char'
	report = json.load(open(os.path.join(src, 'report.json'), encoding='utf-8'))
	os.makedirs(public, exist_ok=True)
	os.makedirs(os.path.join(src, 'show'), exist_ok=True)
	busts, total = {}, 0
	for r in report:
		im = Image.open(os.path.join(src, r['file'])).convert('RGBA')
		if r['shot'] == 'bust' and re.fullmatch(r'[a-z-]+-\d+', r['id']):
			dest = os.path.join(public, r['id'] + '.webp')
			im.resize((BUST_SIZE, BUST_SIZE), Image.LANCZOS).save(dest, 'WEBP', quality=82, method=6)
			busts[r['id']] = '/earth/char/' + r['id'] + '.webp'
			total += os.path.getsize(dest)
		elif r['shot'] == 'full':
			with_shadow(im, r['foot'], r['unit']).save(os.path.join(src, 'show', r['id'] + '.png'))
	if not busts:
		sys.exit('没有找到任何证件照，manifest 不会写——检查渲染输出目录')
	manifest = {
		'note': '人物证件照：由 tools/earth/blender/character.py 在 Blender 里用基本几何体生成并渲染的原创三维人物，不是真人照片，也没有用第三方模型或贴图。键是「出身 id-形象下标」，形象下标对应 character.ts 的 AVATARS。',
		'size': BUST_SIZE,
		'busts': dict(sorted(busts.items(), key=lambda kv: (kv[0].rsplit('-', 1)[0], int(kv[0].rsplit('-', 1)[1])))),
	}
	json.dump(manifest, open(os.path.join(public, 'manifest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent='\t')
	print(f'证件照 {len(busts)} 张，共 {total} 字节，平均 {total // len(busts)} 字节；展示用全身照 {sum(1 for r in report if r["shot"] == "full")} 张')


main()
