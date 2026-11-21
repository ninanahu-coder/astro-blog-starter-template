"""把渲染出来的透明底 PNG 叠到底色上，拼成一张带标签的总览图，方便整批目检。
用法：python3 tools/earth/blender/sheet.py <输出.png> <列数> <单格宽> <图1.png[=标签]> ...
"""
import sys

from PIL import Image, ImageDraw, ImageFont

STOCK, INK = (243, 247, 245), (24, 38, 63)


def font(size):
	for path in ('/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/STHeiti Medium.ttc', '/System/Library/Fonts/Hiragino Sans GB.ttc'):
		try:
			return ImageFont.truetype(path, size)
		except OSError:
			continue
	return ImageFont.load_default()


def main():
	out, cols, cell = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
	items = [a.split('=', 1) if '=' in a else [a, ''] for a in sys.argv[4:]]
	tiles = []
	for path, label in items:
		im = Image.open(path).convert('RGBA')
		h = round(cell * im.height / im.width)
		im = im.resize((cell, h), Image.LANCZOS)
		bg = Image.new('RGBA', im.size, STOCK + (255,))
		bg.alpha_composite(im)
		tiles.append((bg.convert('RGB'), label))
	th = max(t.height for t, _ in tiles)
	pad, lab = 10, 30 if any(l for _, l in tiles) else 0
	rows = -(-len(tiles) // cols)
	sheet = Image.new('RGB', (cols * (cell + pad) + pad, rows * (th + lab + pad) + pad), STOCK)
	d = ImageDraw.Draw(sheet)
	f = font(18)
	for i, (t, label) in enumerate(tiles):
		x, y = pad + (i % cols) * (cell + pad), pad + (i // cols) * (th + lab + pad)
		sheet.paste(t, (x, y + th - t.height))
		if label:
			d.text((x + cell / 2, y + th + 4), label, fill=INK, font=f, anchor='ma')
	sheet.save(out)
	print(out, sheet.size)


main()
