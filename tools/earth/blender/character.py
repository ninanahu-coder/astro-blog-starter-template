"""地球人生 · 人物模型生成器（Blender 5.x，不开界面运行）。

用法：
  blender -b --factory-startup --python tools/earth/blender/character.py -- \
      --spec tools/earth/blender/out/spec.json --out tools/earth/blender/out [--only id1,id2] [--samples 64]

人物完全由本脚本用放样管和椭球体生成，不引用任何第三方模型、贴图或插件，所以没有素材许可证问题。
一个人物 = 形象（looks.json 里的发型、肤色、配件）+ 装束（出身或职业）+ 状态（由游戏数值换算的体型、姿态、表情）。
数值怎么换算成外形见 docs/earth-game/character-models.md；所有换算系数都是「待平衡」。
"""
import json
import math
import os
import sys

import bmesh
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- 基础工具


def srgb(hexstr):
	"""'#rrggbb' → Blender 用的线性 RGBA"""
	h = hexstr.lstrip('#')
	out = []
	for i in (0, 2, 4):
		c = int(h[i:i + 2], 16) / 255
		out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
	return (*out, 1.0)


_MATS = {}


def mat(hexcol, rough=0.62, metallic=0.0, sss=0.0):
	key = (hexcol, rough, metallic, sss)
	if key in _MATS:
		return _MATS[key]
	m = bpy.data.materials.new(f'm_{hexcol}_{rough}')
	if hasattr(m, 'use_nodes'):
		m.use_nodes = True
	bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
	bsdf.inputs['Base Color'].default_value = srgb(hexcol)
	bsdf.inputs['Roughness'].default_value = rough
	bsdf.inputs['Metallic'].default_value = metallic
	if sss:
		bsdf.inputs['Subsurface Weight'].default_value = sss
		bsdf.inputs['Subsurface Radius'].default_value = (1.0, 0.45, 0.3)
		bsdf.inputs['Subsurface Scale'].default_value = 0.03
	_MATS[key] = m
	return m


class Figure:
	"""一个人物的所有物体都挂在 root 下，方便整体转身和删除"""

	def __init__(self, name):
		self.root = bpy.data.objects.new(name, None)
		bpy.context.collection.objects.link(self.root)
		self.objects = []

	def add(self, name, bm, material, sub=1, solid=0.0):
		mesh = bpy.data.meshes.new(name)
		bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
		bm.to_mesh(mesh)
		bm.free()
		mesh.polygons.foreach_set('use_smooth', [True] * len(mesh.polygons))
		obj = bpy.data.objects.new(name, mesh)
		obj.data.materials.append(material)
		bpy.context.collection.objects.link(obj)
		obj.parent = self.root
		if solid:
			s = obj.modifiers.new('solid', 'SOLIDIFY')
			s.thickness = solid
			s.offset = 1.0
		if sub:
			m = obj.modifiers.new('sub', 'SUBSURF')
			m.levels = sub
			m.render_levels = sub
		self.objects.append(obj)
		return obj

	def loft(self, name, pts, radii, material, seg=14, cap=(1.0, 1.0), sub=1):
		"""沿折线放样一根管子。pts 是中心点，radii 是每个点的 (rx, ry)（给单个数就是圆）。
		截面坐标系用平行移动保持不扭转；竖直的管子 rx 沿 X（左右）、ry 沿 Y（前后）。
		cap 是两端圆头的饱满程度：1 是半球，0.4 比较平，0 是直接封平。"""
		pts = [Vector(p) for p in pts]
		radii = [(r, r) if isinstance(r, (int, float)) else r for r in radii]
		n = len(pts)
		tang = []
		for i in range(n):
			a, b = pts[max(0, i - 1)], pts[min(n - 1, i + 1)]
			tang.append((b - a).normalized())
		ref = Vector((1, 0, 0)) if abs(tang[0].x) < 0.9 else Vector((0, 1, 0))
		nrm = (ref - tang[0] * ref.dot(tang[0])).normalized()
		frames = []
		for i in range(n):
			if i:
				nrm = (tang[i - 1].rotation_difference(tang[i]) @ nrm).normalized()
			frames.append((nrm.copy(), tang[i].cross(nrm).normalized()))
		rings = []  # (中心, N, B, rx, ry)
		poles = [None, None]

		def cap_rings(i, sign, k):
			out = []
			c, (N, B), (rx, ry) = pts[i], frames[i], radii[i]
			r = (rx + ry) / 2 * k
			for deg in (35, 65):
				a = math.radians(deg)
				out.append((c + tang[i] * sign * r * math.sin(a), N, B, rx * math.cos(a), ry * math.cos(a)))
			return out, c + tang[i] * sign * r

		if cap[0]:
			extra, poles[0] = cap_rings(0, -1, cap[0])
			rings += list(reversed(extra))
		else:
			poles[0] = pts[0]
		for i in range(n):
			rings.append((pts[i], frames[i][0], frames[i][1], radii[i][0], radii[i][1]))
		if cap[1]:
			extra, poles[1] = cap_rings(n - 1, 1, cap[1])
			rings += extra
		else:
			poles[1] = pts[-1]

		bm = bmesh.new()
		vr = []
		for c, N, B, rx, ry in rings:
			vr.append([bm.verts.new(c + N * rx * math.cos(2 * math.pi * k / seg) + B * ry * math.sin(2 * math.pi * k / seg)) for k in range(seg)])
		for i in range(len(vr) - 1):
			for k in range(seg):
				bm.faces.new((vr[i][k], vr[i][(k + 1) % seg], vr[i + 1][(k + 1) % seg], vr[i + 1][k]))
		p0, p1 = bm.verts.new(poles[0]), bm.verts.new(poles[1])
		for k in range(seg):
			bm.faces.new((p0, vr[0][(k + 1) % seg], vr[0][k]))
			bm.faces.new((p1, vr[-1][k], vr[-1][(k + 1) % seg]))
		return self.add(name, bm, material, sub=sub)

	def ball(self, name, center, scale, material, seg=20, rings=12, keep=None, pole=None, sub=1, solid=0.0):
		"""椭球。keep(x, y, z) 收到的是单位球上的坐标，返回 False 的顶点会被删掉，用来做发际线、面部开口。
		给了 pole 时：keep 在「极轴朝 +z」的球上判断（只用 z 就是按纬度整圈裁，边缘不会有锯齿），裁完再把极轴转到 pole 方向。"""
		if isinstance(scale, (int, float)):
			scale = (scale, scale, scale)
		bm = bmesh.new()
		bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
		if keep:
			bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep(v.co.x, v.co.y, v.co.z)], context='VERTS')
		rot = Vector((0, 0, 1)).rotation_difference(Vector(pole).normalized()) if pole else None
		c = Vector(center)
		for v in bm.verts:
			co = rot @ v.co if rot else v.co
			v.co = Vector((co.x * scale[0], co.y * scale[1], co.z * scale[2])) + c
		return self.add(name, bm, material, sub=sub, solid=solid)

	def remove(self):
		for o in self.objects:
			mesh = o.data
			bpy.data.objects.remove(o, do_unlink=True)
			bpy.data.meshes.remove(mesh)
		bpy.data.objects.remove(self.root, do_unlink=True)


# ---------------------------------------------------------------- 数值 → 外形


def clamp01(x):
	return max(0.0, min(1.0, x))


def shape_from_attrs(attrs):
	"""把游戏数值换成外形参数。系数全部待平衡；魅力、街头、驾驶故意不影响长相（见设计文档 §3）。"""
	g = lambda k, d: float(attrs.get(k, d))
	energy, hygiene = g('energy', 80), g('hygiene', 80)
	mood = (g('fun', 80) + g('social', 80)) / 2
	return {
		'build': clamp01(g('strength', 10) / 100),  # 力量 → 肩宽、手臂粗细
		'lean': clamp01(g('stamina', 10) / 100),  # 体能 → 腰线收紧
		'slouch': clamp01((35 - energy) / 35),  # 精力低于 35 开始驼背
		'eyes': 1.0 if energy >= 35 else 0.45 + 0.55 * energy / 35,  # 精力低 → 眼睛半闭
		'smile': max(-0.6, min(1.0, (mood - 40) / 45)),  # 娱乐和社交的平均 → 嘴角
		'smudge': 0 if hygiene >= 35 else (2 if hygiene >= 15 else 4),  # 清洁低 → 脏污块数
	}


# ---------------------------------------------------------------- 人物


class Body:
	"""骨架关键点。x 右、y 后（脸朝 -y）、z 上，脚底在 z=0，总高约 1.5（约三头身）。"""

	def __init__(self, shape):
		b, lean, s = shape['build'], shape['lean'], shape['slouch']
		self.shape = shape
		self.sh_k = 0.93 + 0.20 * b  # 肩宽
		self.arm_k = 0.88 + 0.44 * b  # 手臂粗细
		self.chest_k = 0.96 + 0.16 * b
		self.waist_k = 1.04 - 0.10 * lean
		self.s = s
		self.head_r = (0.245, 0.232, 0.250)
		self.head_c = self.bend(Vector((0, 0, 1.235)))
		self.shoulder = [self.bend(Vector((sx * (0.158 * self.sh_k + 0.012), 0, 0.905))) for sx in (-1, 1)]

	def bend(self, p):
		"""驼背：腰以上的点往前、往下移"""
		t = max(0.0, (p.z - 0.62) / 0.62)
		return Vector((p.x, p.y - self.s * 0.11 * t ** 1.4, p.z - self.s * 0.035 * t))

	def on_head(self, az, el, out=1.0):
		"""头部表面上的点：az 是从正前方起的水平角（度，右为正），el 是仰角"""
		a, e = math.radians(az), math.radians(el)
		d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
		return self.head_c + Vector((d.x * self.head_r[0], d.y * self.head_r[1], d.z * self.head_r[2])) * out


SKIN_TONES = ['#f6d6bc', '#ecc19c', '#d6a070', '#a9714a', '#70452c']
BLUSH = ['#f0a48f', '#eda088', '#de8b6c', '#bd6c4c', '#8e4d38']  # 腮红跟着肤色走，深肤色用深一档的红
EYE = '#1d1a1a'
LIP = '#8c3f3a'


def build_body(fig, B, look, outfit):
	skin = mat(SKIN_TONES[look['tone']], rough=0.58, sss=0.04)
	top, bottom, shoes = outfit['top'], outfit['bottom'], outfit['shoes']
	m_top = mat(top['color'], rough=0.78)
	m_bot = mat(bottom['color'], rough=0.8)
	# 躯干（就是上衣）
	wk, ck, sk = B.waist_k, B.chest_k, B.sh_k
	torso = [((0, 0, 0.47), (0.150, 0.108)), ((0, 0, 0.62), (0.136 * wk, 0.098 * wk)), ((0, 0, 0.80), (0.158 * sk, 0.112 * ck)), ((0, 0, 0.915), (0.150 * sk, 0.094 * ck))]
	fig.loft('torso', [B.bend(Vector(p)) for p, _ in torso], [r for _, r in torso], m_top, seg=18, cap=(0.55, 0.42))
	# 胯和大腿算裤子；短裤露小腿
	fig.loft('hips', [(0, 0, 0.44), (0, 0, 0.56)], [(0.150, 0.108), (0.146, 0.104)], m_bot, seg=18, cap=(0.6, 0.2))
	for sx in (-1, 1):
		hip, knee, ankle = Vector((sx * 0.082, 0, 0.47)), Vector((sx * 0.086, -0.004, 0.265)), Vector((sx * 0.088, 0.004, 0.07))
		long_legs = bottom.get('len', 'long') == 'long'
		fig.loft(f'thigh{sx}', [hip, knee], [0.078, 0.064], m_bot, cap=(0.8, 0.7))
		fig.loft(f'calf{sx}', [knee, ankle], [0.061 if long_legs else 0.055, 0.050 if long_legs else 0.041], m_bot if long_legs else skin, cap=(0.8, 0.6))
		build_shoe(fig, sx, shoes, skin)
	# 手臂：自然下垂，略微外张
	sleeve = top.get('sleeve', 'short')
	for i, sx in enumerate((-1, 1)):
		sh = B.shoulder[i]
		elbow = B.bend(Vector((sx * (0.218 * sk + 0.012), 0.006, 0.715)))
		wrist = B.bend(Vector((sx * (0.246 * sk + 0.014), -0.022 - 0.03 * B.s, 0.545)))
		ak = B.arm_k
		up_m = skin if sleeve == 'none' else m_top
		fig.loft(f'uparm{sx}', [sh, elbow], [0.056 * ak, 0.047 * ak], up_m, cap=(1.0, 0.8))
		fig.loft(f'forearm{sx}', [elbow, wrist], [0.045 * ak, 0.037 * ak], m_top if sleeve == 'long' else skin, cap=(0.8, 0.6))
		fig.ball(f'hand{sx}', wrist + Vector((sx * 0.004, -0.004, -0.040)), (0.040, 0.046, 0.050), skin, seg=14, rings=8)
	# 脖子、头、耳朵
	fig.loft('neck', [B.bend(Vector((0, 0, 0.90))), B.head_c + Vector((0, 0.01, -0.20))], [0.058 + 0.012 * B.shape['build'], 0.054], skin, cap=(0, 0))
	fig.ball('head', B.head_c, B.head_r, skin, seg=28, rings=18)
	for sx in (-1, 1):
		fig.ball(f'ear{sx}', B.on_head(sx * 92, -6, 0.99), (0.026, 0.040, 0.052), skin, seg=12, rings=8)


def build_shoe(fig, sx, shoes, skin):
	kind = shoes.get('type', 'sneaker')
	c = Vector((sx * 0.090, -0.036, 0.040))
	if kind == 'bare':
		fig.ball(f'foot{sx}', c, (0.052, 0.098, 0.036), skin, seg=14, rings=8)
		return
	if kind == 'thong':  # 人字拖：脚 + 薄鞋底
		fig.ball(f'foot{sx}', c + Vector((0, 0, 0.006)), (0.050, 0.096, 0.034), skin, seg=14, rings=8)
		fig.ball(f'sole{sx}', c + Vector((0, 0, -0.030)), (0.058, 0.108, 0.011), mat(shoes['color'], rough=0.7), seg=14, rings=6)
		return
	m = mat(shoes['color'], rough=0.6)
	fig.ball(f'shoe{sx}', c, (0.062, 0.110, 0.044), m, seg=16, rings=10)
	if kind == 'boot':  # 靴筒
		fig.loft(f'boot{sx}', [(sx * 0.088, 0.004, 0.05), (sx * 0.088, 0.004, 0.15)], [0.062, 0.058], m, cap=(0.3, 0.25))
	fig.ball(f'sole{sx}', c + Vector((0, 0, -0.032)), (0.064, 0.113, 0.012), mat(shoes.get('sole', '#efe9dc'), rough=0.7), seg=16, rings=6)


def build_face(fig, B, look):
	sh = B.shape
	skin = mat(SKIN_TONES[look['tone']], rough=0.58, sss=0.04)
	hair = look['hair']
	hide_eyes = 'sunnies' in look.get('extras', [])
	if not hide_eyes:
		for sx in (-1, 1):
			fig.ball(f'eye{sx}', B.on_head(sx * 19.5, 1.5, 0.975), (0.030, 0.020, 0.040 * sh['eyes']), mat(EYE, rough=0.18), seg=14, rings=10)
			fig.ball(f'glint{sx}', B.on_head(sx * 19.5 - 2.4, 4.6 * sh['eyes'], 1.045), 0.0075, mat('#ffffff', rough=0.3), seg=8, rings=6, sub=0)
			# 眉毛：精力低时压平，高兴时略扬
			lift = 13.5 + 2.0 * max(0.0, sh['smile']) - 3.0 * (1 - sh['eyes'])
			tilt = -1.5 * (1 - sh['eyes'])
			sad = max(0.0, -sh['smile'])
			brow = [B.on_head(sx * 13, lift + tilt + 4.0 * sad, 1.012), B.on_head(sx * 20, lift + 1.6 + 1.0 * sad, 1.014), B.on_head(sx * 27, lift - 0.4 - 2.6 * sad, 1.012)]
			fig.loft(f'brow{sx}', brow, [0.0075, 0.0085, 0.0065], mat(hair.get('brow', hair['color']), rough=0.7), seg=8, cap=(1, 1), sub=1)
	fig.ball('nose', B.on_head(0, -9, 1.0), (0.020, 0.026, 0.020), skin, seg=12, rings=8)
	for sx in (-1, 1):  # 腮红
		fig.ball(f'blush{sx}', B.on_head(sx * 36, -17, 0.965), (0.050, 0.024, 0.032), mat(BLUSH[look['tone']], rough=0.8), seg=12, rings=8)
	# 嘴：一条贴在脸上的弧线，smile > 0 嘴角上扬
	w, s = 11.5, sh['smile']
	mouth = [B.on_head(a, -25.5 - 5.2 * s * (1 - (a / w) ** 2), 1.008) for a in (-w, -w * 0.5, 0, w * 0.5, w)]
	fig.loft('mouth', mouth, [0.0062, 0.0082, 0.0090, 0.0082, 0.0062], mat(LIP, rough=0.5), seg=8, cap=(1, 1))
	for i in range(sh['smudge']):  # 脏污：脸和衣服上的灰块
		spot = [B.on_head(-30, 4, 0.97), B.bend(Vector((0.07, -0.103, 0.74))), B.on_head(27, -22, 0.97), B.bend(Vector((-0.06, -0.100, 0.66)))][i]
		fig.ball(f'smudge{i}', spot, (0.034, 0.016, 0.026) if i % 2 == 0 else (0.050, 0.014, 0.040), mat('#5f5244', rough=0.95), seg=10, rings=6)


def build_hair(fig, B, look, covered=False):
	"""covered：装束的帽子戴在头上，露在帽子外面的刘海、发髻要收掉"""
	hair = look['hair']
	style = hair['style']
	m = mat(hair['color'], rough=0.5)
	C, R = B.head_c, B.head_r

	def cap(tilt, cut, name='hair'):
		# 发帽：极轴往后仰 tilt，保留纬度高于 cut 的部分。tilt 越大前额露得越多、后脑盖得越低
		fig.ball(name, C + Vector((0, 0.006, 0.010)), (R[0] * 1.04, R[1] * 1.045, R[2] * 1.06), m, seg=32, rings=20, keep=lambda x, y, z: z > cut, pole=(0, tilt, 1), solid=0.012)

	def fringe(points, radii, name='fringe'):
		if covered:
			return
		fig.loft(name, [B.on_head(az, el, out) for az, el, out in points], radii, m, seg=10, cap=(1, 1))

	if style == 'short':
		cap(0.46, 0.06)
		fringe([(-34, 31, 1.035), (-12, 27, 1.05), (12, 27, 1.05), (34, 31, 1.035)], [0.036, 0.048, 0.048, 0.036])
	elif style == 'side':  # 侧分：刘海从左往右扫
		cap(0.46, 0.05)
		fringe([(-40, 30, 1.03), (-16, 25, 1.055), (10, 26, 1.06), (36, 34, 1.04)], [0.032, 0.050, 0.056, 0.040])
	elif style == 'long':
		cap(0.52, -0.02)
		fringe([(-38, 28, 1.035), (-14, 23, 1.055), (14, 23, 1.055), (38, 28, 1.035)], [0.040, 0.050, 0.050, 0.040])
		back = [C + Vector((0, 0.10, 0.02)), C + Vector((0, 0.150, -0.22)), B.bend(Vector((0, 0.135, 0.83))), B.bend(Vector((0, 0.120, 0.74)))]
		fig.loft('hair-back', back, [(0.235, 0.14), (0.225, 0.095), (0.205, 0.060), (0.170, 0.042)], m, seg=16, cap=(0.5, 0.8))
		for sx in (-1, 1):  # 两侧垂到锁骨的发束
			lock = [B.on_head(sx * 76, 12, 1.03), B.on_head(sx * 72, -38, 1.05), B.bend(Vector((sx * 0.168, -0.035, 0.90)))]
			fig.loft(f'lock{sx}', lock, [0.050, 0.046, 0.030], m, seg=10, cap=(1, 1))
	elif style == 'bun':
		cap(0.50, 0.04)
		if covered:  # 发髻压低到帽子后面
			fig.ball('bun', C + Vector((0, 0.215, -0.02)), (0.070, 0.062, 0.070), m, seg=16, rings=10)
		else:
			fig.ball('bun', C + Vector((0, 0.085, 0.262)), (0.086, 0.086, 0.078), m, seg=16, rings=10)
	elif style == 'curly':  # 一圈圈小卷：按黄金角分布，留出脸
		cap(0.46, 0.08)
		for i in range(40):
			t = (i + 0.5) / 40
			el, az = 86 - 92 * t, i * 137.5
			front = abs(((az + 180) % 360) - 180)
			if (front < 58 and el < 31) or (covered and el > 14):
				continue
			fig.ball(f'curl{i}', B.on_head(az, el, 1.06), 0.062 + 0.008 * (i % 3), m, seg=10, rings=6)
	elif style == 'under-hat':
		cap(0.50, 0.0)
	elif style == 'hijab':
		scarf = mat(hair['color'], rough=0.85)
		# 头巾：整球，朝脸的方向（略往下）裁掉一个圆口；领口用一圈披肩盖住脖子
		fig.ball('scarf', C + Vector((0, 0.008, 0.006)), (R[0] * 1.075, R[1] * 1.08, R[2] * 1.075), scarf, seg=40, rings=28, keep=lambda x, y, z: z < 0.745, pole=(0, -0.978, -0.208), solid=0.018)
		fig.ball('scarf-cowl', B.bend(Vector((0, 0.002, 0.928))), (0.226 * B.sh_k, 0.176, 0.066), scarf, seg=24, rings=12)
		fig.ball('scarf-front', B.bend(Vector((0, -0.070 * B.chest_k, 0.878))), (0.150, 0.060, 0.078), scarf, seg=18, rings=10)
	if hair.get('beard'):
		bm_ = mat(hair['beard'], rough=0.6)
		jaw = [(-86, -6), (-70, -27), (-46, -42), (0, -50), (46, -42), (70, -27), (86, -6)]
		fig.loft('beard', [B.on_head(az, el, 1.0) for az, el in jaw], [0.024, 0.040, 0.054, 0.060, 0.054, 0.040, 0.024], bm_, seg=12, cap=(1, 1))
		fig.loft('moustache', [B.on_head(az, -17.5 - 2.5 * abs(az) / 15, 1.012) for az in (-15, -7, 0, 7, 15)], [0.010, 0.015, 0.015, 0.015, 0.010], bm_, seg=8, cap=(1, 1))


def build_look_extras(fig, B, look):
	extras = look.get('extras', [])
	C, R = B.head_c, B.head_r
	if 'sunnies' in extras:
		lens = mat('#16181d', rough=0.12)
		for sx in (-1, 1):
			fig.ball(f'lens{sx}', B.on_head(sx * 19.5, 2.0, 1.02), (0.066, 0.016, 0.050), lens, seg=16, rings=10)
			arm = [B.on_head(sx * 34, 3.0, 1.03), B.on_head(sx * 70, 3.5, 1.04), B.on_head(sx * 95, 2.0, 1.03)]
			fig.loft(f'arm{sx}', arm, [0.006, 0.006, 0.006], lens, seg=6, cap=(1, 1), sub=0)
		fig.loft('bridge', [B.on_head(-7, 3.5, 1.035), B.on_head(7, 3.5, 1.035)], [0.006, 0.006], lens, seg=6, cap=(1, 1), sub=0)
	if 'widehat' in extras:
		build_hat(fig, B, look.get('hat', '#b08a56'), brim=0.345, crown=0.135, band='#5a3d25')


def build_hat(fig, B, color, brim, crown, band=None):
	"""宽檐帽：帽檐是压扁的椭球，帽身是一段放样管（要高过头顶，不然头发会穿出来）"""
	C, R = B.head_c, B.head_r
	m = mat(color, rough=0.82)
	base = C + Vector((0, 0.008, R[2] * 0.40))
	fig.ball('hat-brim', base + Vector((0, 0, 0.004)), (brim, brim * 0.96, 0.016), m, seg=32, rings=8)
	fig.loft('hat-crown', [base, base + Vector((0, 0, crown * 0.55)), base + Vector((0, 0, crown))], [(R[0] * 1.02, R[1] * 1.04), (R[0] * 0.97, R[1] * 0.99), (R[0] * 0.86, R[1] * 0.88)], m, seg=22, cap=(0, 0.42))
	if band:
		fig.loft('hat-band', [base + Vector((0, 0, 0.014)), base + Vector((0, 0, 0.046))], [(R[0] * 1.06, R[1] * 1.08), (R[0] * 1.045, R[1] * 1.065)], mat(band, rough=0.7), seg=22, cap=(0, 0))


def headwear_of(look, outfit, shot):
	"""这张图里装束的帽子会不会戴上：只在全身照里戴，形象自带头饰（头巾、宽檐帽）时不戴，免得盖掉形象"""
	if shot != 'full' or look['hair']['style'] == 'hijab' or 'widehat' in look.get('extras', []):
		return None
	return next((ex['kind'] for ex in outfit.get('extras', []) if ex['kind'] in ('hardhat', 'cap', 'widehat')), None)


def build_outfit_extras(fig, B, look, outfit, shot):
	"""装束的配件。帽子戴不戴由 headwear_of 决定。"""
	sk, ck = B.sh_k, B.chest_k
	headwear_ok = headwear_of(look, outfit, shot) is not None
	for ex in outfit.get('extras', []):
		kind = ex['kind']
		if kind == 'stripes':  # 反光条：胸口一圈、两肩各一条
			m = mat(ex.get('color', '#b9c0c6'), rough=0.42)
			fig.loft('stripe-chest', [B.bend(Vector((0, 0, 0.705))), B.bend(Vector((0, 0, 0.735)))], [(0.153 * sk, 0.112 * ck), (0.156 * sk, 0.114 * ck)], m, seg=18, cap=(0, 0))
			for sx in (-1, 1):
				strap = [B.bend(Vector((sx * 0.085 * sk, -0.106 * ck, 0.74))), B.bend(Vector((sx * 0.090 * sk, -0.092 * ck, 0.86))), B.bend(Vector((sx * 0.088 * sk, -0.02, 0.935))), B.bend(Vector((sx * 0.086 * sk, 0.085 * ck, 0.86))), B.bend(Vector((sx * 0.082 * sk, 0.100 * ck, 0.74)))]
				fig.loft(f'stripe{sx}', strap, [(0.017, 0.006)] * 5, m, seg=8, cap=(0.3, 0.3))
		elif kind == 'backpack':
			m = mat(ex['color'], rough=0.8)
			big = ex.get('size', 'big') == 'big'
			h0, h1, depth = (0.60, 0.94, 0.105) if big else (0.66, 0.90, 0.075)
			pack = [B.bend(Vector((0, 0.150 + depth * 0.5, h0))), B.bend(Vector((0, 0.150 + depth * 0.55, (h0 + h1) / 2))), B.bend(Vector((0, 0.140 + depth * 0.5, h1)))]
			fig.loft('pack', pack, [(0.130, depth), (0.140, depth * 1.05), (0.120, depth * 0.9)], m, seg=16, cap=(0.5, 0.6))
			if big:  # 顶上横放的防潮垫
				fig.loft('bedroll', [B.bend(Vector((-0.150, 0.215, 0.975))), B.bend(Vector((0.150, 0.215, 0.975)))], [0.052, 0.052], mat(ex.get('roll', '#d9b36a'), rough=0.85), seg=14, cap=(0.25, 0.25))
			for sx in (-1, 1):  # 背带：从肩前绕到腋下
				strap = [B.bend(Vector((sx * 0.105 * sk, 0.085 * ck, 0.90))), B.bend(Vector((sx * 0.108 * sk, -0.02, 0.945))), B.bend(Vector((sx * 0.112 * sk, -0.104 * ck, 0.86))), B.bend(Vector((sx * 0.128 * sk, -0.098 * ck, 0.72))), B.bend(Vector((sx * 0.150 * sk, 0.02, 0.66)))]
				fig.loft(f'strap{sx}', strap, [(0.020, 0.007)] * 5, mat(ex.get('strap', ex['color']), rough=0.8), seg=8, cap=(0.3, 0.3))
		elif kind == 'apron':
			m = mat(ex['color'], rough=0.85)
			bib = ex.get('bib', True)
			top_z = 0.83 if bib else 0.63
			fig.loft('apron', [B.bend(Vector((0, -0.098 * ck, 0.41))), B.bend(Vector((0, -0.102 * ck, 0.60))), B.bend(Vector((0, -0.106 * ck, top_z)))], [(0.130, 0.012), (0.126, 0.013), (0.096 if bib else 0.126, 0.012)], m, seg=14, cap=(0.15, 0.15))
			fig.loft('apron-tie', [B.bend(Vector((0, 0, 0.615))), B.bend(Vector((0, 0, 0.640)))], [(0.141 * B.waist_k, 0.103 * B.waist_k)] * 2, m, seg=18, cap=(0, 0))
			if bib:
				for sx in (-1, 1):
					fig.loft(f'apron-neck{sx}', [B.bend(Vector((sx * 0.070, -0.108 * ck, 0.82))), B.bend(Vector((sx * 0.062, -0.060, 0.925))), B.bend(Vector((sx * 0.050, 0.030, 0.935)))], [(0.012, 0.005)] * 3, m, seg=8, cap=(0.3, 0.3))
		elif kind == 'lanyard':
			m = mat(ex.get('color', '#1d3fbf'), rough=0.6)
			for sx in (-1, 1):
				fig.loft(f'lanyard{sx}', [B.bend(Vector((sx * 0.052, 0.02, 0.935))), B.bend(Vector((sx * 0.050, -0.085, 0.905))), B.bend(Vector((sx * 0.012, -0.116 * ck, 0.745)))], [(0.008, 0.004)] * 3, m, seg=6, cap=(0.3, 0.3), sub=0)
			fig.loft('badge', [B.bend(Vector((0, -0.120 * ck, 0.745))), B.bend(Vector((0, -0.120 * ck, 0.675)))], [(0.030, 0.005), (0.030, 0.005)], mat('#f3f7f5', rough=0.5), seg=10, cap=(0.15, 0.15))
		elif kind == 'toolbelt':
			m = mat(ex.get('color', '#6b4a2b'), rough=0.75)
			fig.loft('belt', [B.bend(Vector((0, 0, 0.555))), B.bend(Vector((0, 0, 0.595)))], [(0.156, 0.113), (0.150, 0.109)], m, seg=18, cap=(0, 0))
			for sx in (-1, 1):
				fig.loft(f'pouch{sx}', [B.bend(Vector((sx * 0.150, -0.02, 0.575))), B.bend(Vector((sx * 0.158, -0.02, 0.475)))], [(0.030, 0.050), (0.026, 0.044)], m, seg=10, cap=(0.4, 0.5))
		elif kind == 'collar':  # 翻领：脖子根的一圈
			fig.loft('collar', [B.bend(Vector((0, 0.004, 0.905))), B.bend(Vector((0, 0.004, 0.945)))], [(0.082, 0.074), (0.066, 0.060)], mat(ex.get('color', outfit['top']['color']), rough=0.78), seg=16, cap=(0, 0))
		elif kind == 'hood':  # 卫衣帽子：堆在后颈
			fig.loft('hood', [B.bend(Vector((-0.090, 0.085, 0.925))), B.bend(Vector((0, 0.128, 0.965))), B.bend(Vector((0.090, 0.085, 0.925)))], [(0.050, 0.060), (0.062, 0.072), (0.050, 0.060)], mat(outfit['top']['color'], rough=0.78), seg=12, cap=(0.9, 0.9))
			for sx in (-1, 1):  # 抽绳
				fig.loft(f'cord{sx}', [B.bend(Vector((sx * 0.034, -0.090, 0.900))), B.bend(Vector((sx * 0.030, -0.116 * ck, 0.800)))], [0.0055, 0.0055], mat('#f3f7f5', rough=0.6), seg=6, cap=(1, 1), sub=0)
			fig.loft('pocket', [B.bend(Vector((0, -0.100 * B.waist_k, 0.585))), B.bend(Vector((0, -0.104 * B.waist_k, 0.665)))], [(0.092, 0.014), (0.080, 0.014)], mat(outfit['top']['color'], rough=0.78), seg=12, cap=(0.2, 0.2))
		elif kind == 'hardhat' and headwear_ok:
			m = mat(ex.get('color', '#f5f5f0'), rough=0.35)
			C, R = B.head_c, B.head_r
			dome = lambda x, y, z: z > 0.22
			fig.ball('hardhat', C + Vector((0, 0.0, 0.012)), (R[0] * 1.12, R[1] * 1.13, R[2] * 1.10), m, seg=28, rings=16, keep=dome, solid=0.012)
			fig.ball('hardhat-brim', C + Vector((0, -0.045, R[2] * 0.265)), (R[0] * 1.14, R[1] * 1.26, 0.013), m, seg=24, rings=6)
		elif kind == 'cap' and headwear_ok:
			m = mat(ex.get('color', '#b3202a'), rough=0.75)
			C, R = B.head_c, B.head_r
			dome = lambda x, y, z: z > 0.30
			fig.ball('cap', C + Vector((0, 0.004, 0.008)), (R[0] * 1.07, R[1] * 1.08, R[2] * 1.07), m, seg=28, rings=16, keep=dome, solid=0.012)
			fig.ball('cap-peak', C + Vector((0, -R[1] * 1.10, R[2] * 0.345)), (R[0] * 0.66, R[1] * 0.50, 0.012), m, seg=18, rings=6)
		elif kind == 'widehat' and headwear_ok:
			build_hat(fig, B, ex.get('color', '#b08a56'), brim=ex.get('brim', 0.34), crown=0.135, band=ex.get('band'))
		elif kind == 'surfboard' and shot == 'full':
			# 立在身旁的冲浪板：一头尖一头圆的薄片
			m = mat(ex.get('color', '#f3efe2'), rough=0.3)
			x = 0.385
			pts = [(x, 0.09, 0.02), (x, 0.09, 0.32), (x, 0.09, 0.80), (x, 0.09, 1.24), (x, 0.09, 1.50)]
			fig.loft('board', pts, [(0.090, 0.018), (0.140, 0.024), (0.145, 0.024), (0.105, 0.020), (0.036, 0.013)], m, seg=18, cap=(0.5, 0.9))
			fig.loft('board-stripe', [(x, 0.066, 0.25), (x, 0.064, 0.80), (x, 0.066, 1.30)], [(0.018, 0.004)] * 3, mat(ex.get('stripe', '#2aa7a1'), rough=0.3), seg=8, cap=(0.4, 0.4))


def build_character(spec, looks, outfits, shot):
	look = looks[spec['look']]
	outfit = outfits[spec['outfit']]
	shape = shape_from_attrs(spec.get('attrs', {}))
	fig = Figure(spec['id'])
	B = Body(shape)
	build_body(fig, B, look, outfit)
	build_face(fig, B, look)
	build_hair(fig, B, look, covered=headwear_of(look, outfit, shot) is not None)
	build_look_extras(fig, B, look)
	build_outfit_extras(fig, B, look, outfit, shot)
	return fig, B


# ---------------------------------------------------------------- 场景、相机、出图


def aim(obj, target):
	obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def setup_scene(samples):
	for o in list(bpy.data.objects):
		bpy.data.objects.remove(o, do_unlink=True)
	sc = bpy.context.scene
	sc.render.engine = 'CYCLES'
	try:
		prefs = bpy.context.preferences.addons['cycles'].preferences
		prefs.compute_device_type = 'METAL'
		prefs.get_devices()
		for d in prefs.devices:
			d.use = True
		sc.cycles.device = 'GPU'
	except Exception as e:  # 没有 GPU 就用 CPU，只是慢
		print('GPU 不可用，改用 CPU：', e)
		sc.cycles.device = 'CPU'
	sc.cycles.samples = samples
	sc.cycles.use_denoising = True
	sc.render.film_transparent = True
	sc.render.image_settings.file_format = 'PNG'
	sc.render.image_settings.color_mode = 'RGBA'
	sc.view_settings.view_transform = 'Standard'  # 颜色按给定的色值出，方便和界面色板对齐
	world = bpy.data.worlds.new('world')
	if hasattr(world, 'use_nodes'):
		world.use_nodes = True
	bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
	bg.inputs['Color'].default_value = (0.80, 0.84, 0.90, 1)
	bg.inputs['Strength'].default_value = 0.42
	sc.world = world
	for name, loc, size, energy, color in (
		('key', (-1.7, -2.6, 2.7), 2.4, 150, (1.0, 0.97, 0.93)),
		('fill', (2.2, -2.0, 1.3), 3.0, 55, (0.93, 0.96, 1.0)),
		('rim', (0.9, 2.3, 2.5), 1.4, 110, (1.0, 0.98, 0.95)),
	):
		light = bpy.data.lights.new(name, 'AREA')
		light.size, light.energy, light.color = size, energy, color
		obj = bpy.data.objects.new(name, light)
		obj.location = loc
		bpy.context.collection.objects.link(obj)
		aim(obj, (0, 0, 0.95))
	cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
	bpy.context.collection.objects.link(cam)
	sc.camera = cam
	return sc, cam


SHOTS = {
	# 名字: (分辨率, 镜头焦距, 取景中心 z, 取景高度, 取景宽度, 人物转身角度, 相机俯角)
	# 背景透明、不带地面；全身照脚下的影子由 export.py 按 report.json 里的落脚点画上去
	'bust': ((640, 640), 85, 1.150, 1.00, 1.00, 0, 0),
	'full': ((720, 960), 70, 0.785, 1.84, 1.32, -18, 4),
}


def frame(sc, cam, shot):
	res, lens, cz, h, w, _, pitch = SHOTS[shot]
	sc.render.resolution_x, sc.render.resolution_y = res
	sc.render.resolution_percentage = 100
	cam.data.lens = lens
	aspect = res[0] / res[1]
	half = math.atan(18 / lens)  # 传感器 36mm 对应画面较长的一边
	fov_h, fov_v = (half, math.atan(18 / aspect / lens)) if aspect >= 1 else (math.atan(18 * aspect / lens), half)
	dist = max(h / 2 / math.tan(fov_v), w / 2 / math.tan(fov_h))
	p = math.radians(pitch)
	center = Vector((0, 0, cz))
	cam.location = center + Vector((0, -math.cos(p), math.sin(p))) * dist
	aim(cam, center)


def in_frame(sc, cam, fig):
	"""把人物所有顶点投到画面上，返回 (最小 x, 最大 x, 最小 y, 最大 y)，画面范围是 0–1。出图前用来确认没有被裁掉。"""
	bpy.context.view_layer.update()
	deps = bpy.context.evaluated_depsgraph_get()
	xs, ys = [], []
	for o in fig.objects:
		ev = o.evaluated_get(deps)
		for corner in ev.bound_box:
			v = world_to_camera_view(sc, cam, ev.matrix_world @ Vector(corner))
			xs.append(v.x)
			ys.append(v.y)
	return [round(min(xs), 3), round(max(xs), 3), round(min(ys), 3), round(max(ys), 3)]


def main():
	argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
	opt = {'--samples': '64'}
	for i in range(0, len(argv), 2):
		opt[argv[i]] = argv[i + 1]
	spec = json.load(open(opt['--spec'], encoding='utf-8'))
	looks = json.load(open(os.path.join(HERE, 'looks.json'), encoding='utf-8'))
	only = set(opt['--only'].split(',')) if '--only' in opt else None
	out = opt['--out']
	os.makedirs(out, exist_ok=True)
	sc, cam = setup_scene(int(opt['--samples']))
	report = []
	for ch in spec['characters']:
		if only and ch['id'] not in only:
			continue
		for shot in ch.get('shots', ['bust']):
			fig, B = build_character(ch, looks['looks'], looks['outfits'], shot)
			fig.root.rotation_euler = (0, 0, math.radians(SHOTS[shot][5]))
			frame(sc, cam, shot)
			box = in_frame(sc, cam, fig)
			# 落脚点和「一个单位长度占画面多宽」，给后期画脚下的影子用
			foot = world_to_camera_view(sc, cam, Vector((0, 0, 0)))
			unit = world_to_camera_view(sc, cam, Vector((1, 0, 0))).x - foot.x
			path = os.path.join(out, f"{ch['id']}.{shot}.png")
			sc.render.filepath = path
			bpy.ops.render.render(write_still=True)
			tris = sum(len(o.evaluated_get(bpy.context.evaluated_depsgraph_get()).data.loop_triangles) or 0 for o in fig.objects)
			report.append({'id': ch['id'], 'shot': shot, 'file': os.path.basename(path), 'box': box, 'foot': [round(foot.x, 4), round(foot.y, 4)], 'unit': round(unit, 4), 'objects': len(fig.objects), 'tris': tris})
			print('RENDERED', json.dumps(report[-1], ensure_ascii=False))
			fig.remove()
	report_path = os.path.join(out, 'report.json')
	if only and os.path.exists(report_path):  # 只重渲了一部分：并进已有的记录
		fresh = {(r['id'], r['shot']) for r in report}
		report = [r for r in json.load(open(report_path, encoding='utf-8')) if (r['id'], r['shot']) not in fresh] + report
		order = {c['id']: n for n, c in enumerate(spec['characters'])}
		report.sort(key=lambda r: (order.get(r['id'], 1e9), r['shot']))
	json.dump(report, open(report_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
	print('DONE', len(report))
	if not report:
		sys.exit('一张图都没渲出来（--only 没对上？），不能当成功')
	cropped = [r['id'] for r in report if r['box'][0] < 0.02 or r['box'][1] > 0.98 or r['box'][3] > 0.98 or (r['shot'] == 'full' and r['box'][2] < 0.004)]
	if cropped:
		sys.exit(f'这些人物出了画面：{cropped}')
	if '--blend' in opt:  # 并排摆出 --lineup 里的人物，存成 .blend 和 .glb（给人在 Blender 里看模型用，不进仓库）
		ids = opt.get('--lineup', '').split(',')
		by_id = {c['id']: c for c in spec['characters']}
		figs = []
		for n, cid in enumerate(i for i in ids if i in by_id):
			fig, _ = build_character(by_id[cid], looks['looks'], looks['outfits'], 'full')
			fig.root.location = ((n - (len(ids) - 1) / 2) * 0.78, 0, 0)
			figs.append(fig)
		frame(sc, cam, 'full')
		cam.location.y *= 1.9
		bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(opt['--blend']))
		glb = os.path.abspath(opt['--blend']).replace('.blend', '.glb')
		for o in bpy.data.objects:
			o.select_set(o.type == 'MESH')
		bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_apply=True)
		print('SAVED', opt['--blend'], os.path.getsize(opt['--blend']), glb, os.path.getsize(glb))


main()
