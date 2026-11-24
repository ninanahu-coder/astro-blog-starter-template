"""尖峰石阵到达短片（Blender 程序化建模，Cycles）：黄沙丘 + 成片石灰岩柱 + 日落天空，相机低空穿进石柱之间。
依据（docs/earth-game/aigc-media.md §6.4 资料第 3 条）：黄沙上成千根石灰岩柱，最高 3.5 m，有的尖、有的像墓碑；不加动物、不加人。
用法：
  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/earth/media/blender/pinnacles.py -- --still 60 --out <目录>
  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/earth/media/blender/pinnacles.py -- --anim --out <目录> [--samples 96]
"""
import argparse, math, random, sys
import bpy
from mathutils import Vector, noise

ap = argparse.ArgumentParser()
ap.add_argument('--still', type=int, default=None)
ap.add_argument('--anim', action='store_true')
ap.add_argument('--out', required=True)
ap.add_argument('--samples', type=int, default=96)
ap.add_argument('--res', type=int, default=1280)
a = ap.parse_args(sys.argv[sys.argv.index('--') + 1:])

FPS, FRAMES = 24, 124
random.seed(7)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'GPU'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'METAL'
prefs.get_devices()
for d in prefs.devices: d.use = True
sc.cycles.samples = a.samples
sc.cycles.use_denoising = True
sc.cycles.use_adaptive_sampling = True
sc.cycles.adaptive_threshold = 0.02
sc.render.resolution_x, sc.render.resolution_y = a.res, a.res * 9 // 16
sc.render.fps = FPS
sc.frame_start, sc.frame_end = 1, FRAMES
sc.render.use_motion_blur = True
sc.render.motion_blur_shutter = 0.4
sc.view_settings.view_transform = 'AgX'
for look in ('AgX - Punchy', 'AgX - Medium High Contrast'):
    try: sc.view_settings.look = look; break
    except TypeError: pass
sc.view_settings.exposure = -0.9


def height(x, y):
    """沙丘高度：大起伏 + 中等沙垄"""
    return 1.6 * noise.noise(Vector((x * 0.018, y * 0.018, 0.0))) + 0.5 * noise.noise(Vector((x * 0.06, y * 0.06, 3.1)))


# ---------- 沙地 ----------
N, SIZE = 400, 500.0
verts = [((i / N - 0.5) * SIZE, (j / N - 0.5) * SIZE, 0.0) for j in range(N + 1) for i in range(N + 1)]
verts = [(x, y, height(x, y)) for x, y, _ in verts]
faces = [(j * (N + 1) + i, j * (N + 1) + i + 1, (j + 1) * (N + 1) + i + 1, (j + 1) * (N + 1) + i) for j in range(N) for i in range(N)]
me = bpy.data.meshes.new('sand'); me.from_pydata(verts, [], faces)
for p in me.polygons: p.use_smooth = True
sand = bpy.data.objects.new('sand', me); sc.collection.objects.link(sand)

m = bpy.data.materials.new('sand'); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
out = nt.nodes.new('ShaderNodeOutputMaterial'); bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
tc = nt.nodes.new('ShaderNodeTexCoord')
# 风成沙纹：沿一个方向拉长的波纹 + 噪声扰动
mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1.0, 0.12, 1.0); mp.inputs['Rotation'].default_value = (0, 0, 0.5)
wave = nt.nodes.new('ShaderNodeTexWave'); wave.inputs['Scale'].default_value = 22.0; wave.inputs['Distortion'].default_value = 5.0; wave.inputs['Detail'].default_value = 3.0; wave.inputs['Detail Scale'].default_value = 1.5
grain = nt.nodes.new('ShaderNodeTexNoise'); grain.inputs['Scale'].default_value = 900.0
patch = nt.nodes.new('ShaderNodeTexNoise'); patch.inputs['Scale'].default_value = 0.05; patch.inputs['Detail'].default_value = 4.0
ramp = nt.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = (0.80, 0.40, 0.09, 1); ramp.color_ramp.elements[1].color = (0.95, 0.58, 0.17, 1)
bump1 = nt.nodes.new('ShaderNodeBump'); bump1.inputs['Strength'].default_value = 0.6; bump1.inputs['Distance'].default_value = 0.05
bump2 = nt.nodes.new('ShaderNodeBump'); bump2.inputs['Strength'].default_value = 0.08; bump2.inputs['Distance'].default_value = 0.004
L = nt.links.new
L(tc.outputs['Object'], mp.inputs['Vector']); L(mp.outputs['Vector'], wave.inputs['Vector'])
L(tc.outputs['Object'], grain.inputs['Vector']); L(tc.outputs['Object'], patch.inputs['Vector'])
L(patch.outputs['Fac'], ramp.inputs['Fac']); L(ramp.outputs['Color'], bsdf.inputs['Base Color'])
msk = nt.nodes.new('ShaderNodeTexNoise'); msk.inputs['Scale'].default_value = 0.25; mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'
L(tc.outputs['Object'], msk.inputs['Vector']); L(wave.outputs['Fac'], mul.inputs[0]); L(msk.outputs['Fac'], mul.inputs[1]); L(mul.outputs['Value'], bump1.inputs['Height']); L(grain.outputs['Fac'], bump2.inputs['Height']); L(bump1.outputs['Normal'], bump2.inputs['Normal'])
L(bump2.outputs['Normal'], bsdf.inputs['Normal']); bsdf.inputs['Roughness'].default_value = 0.92
L(bsdf.outputs['BSDF'], out.inputs['Surface'])
sand.data.materials.append(m)

# ---------- 石灰岩柱 ----------
rock = bpy.data.materials.new('limestone'); rock.use_nodes = True; nt = rock.node_tree; nt.nodes.clear()
out = nt.nodes.new('ShaderNodeOutputMaterial'); bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled'); tc = nt.nodes.new('ShaderNodeTexCoord')
n1 = nt.nodes.new('ShaderNodeTexNoise'); n1.inputs['Scale'].default_value = 3.0; n1.inputs['Detail'].default_value = 8.0; n1.inputs['Roughness'].default_value = 0.65
vor = nt.nodes.new('ShaderNodeTexVoronoi'); vor.inputs['Scale'].default_value = 9.0; vor.feature = 'DISTANCE_TO_EDGE'
n2 = nt.nodes.new('ShaderNodeTexNoise'); n2.inputs['Scale'].default_value = 40.0; n2.inputs['Detail'].default_value = 6.0
ramp = nt.nodes.new('ShaderNodeValToRGB'); e = ramp.color_ramp.elements
e[0].position = 0.3; e[0].color = (0.36, 0.22, 0.10, 1); e[1].position = 0.75; e[1].color = (0.92, 0.74, 0.46, 1)
# 高处偏白、根部被沙染黄
sep = nt.nodes.new('ShaderNodeSeparateXYZ'); mixc = nt.nodes.new('ShaderNodeMixRGB'); mixc.blend_type = 'MULTIPLY'; mixc.inputs['Fac'].default_value = 0.7
gr = nt.nodes.new('ShaderNodeValToRGB'); gr.color_ramp.elements[0].color = (0.85, 0.62, 0.30, 1); gr.color_ramp.elements[1].position = 0.5; gr.color_ramp.elements[1].color = (1, 1, 1, 1)
b1 = nt.nodes.new('ShaderNodeBump'); b1.inputs['Strength'].default_value = 0.9; b1.inputs['Distance'].default_value = 0.15
b2 = nt.nodes.new('ShaderNodeBump'); b2.inputs['Strength'].default_value = 0.5; b2.inputs['Distance'].default_value = 0.05
b3 = nt.nodes.new('ShaderNodeBump'); b3.inputs['Strength'].default_value = 0.3; b3.inputs['Distance'].default_value = 0.01
L = nt.links.new
for n in (n1, vor, n2): L(tc.outputs['Object'], n.inputs['Vector'])
L(n1.outputs['Fac'], ramp.inputs['Fac']); L(tc.outputs['Generated'], sep.inputs['Vector']); L(sep.outputs['Z'], gr.inputs['Fac'])
L(ramp.outputs['Color'], mixc.inputs['Color1']); L(gr.outputs['Color'], mixc.inputs['Color2']); L(mixc.outputs['Color'], bsdf.inputs['Base Color'])
L(n1.outputs['Fac'], b1.inputs['Height']); L(vor.outputs['Distance'], b2.inputs['Height']); L(n2.outputs['Fac'], b3.inputs['Height'])
L(b1.outputs['Normal'], b2.inputs['Normal']); L(b2.outputs['Normal'], b3.inputs['Normal']); L(b3.outputs['Normal'], bsdf.inputs['Normal'])
bsdf.inputs['Roughness'].default_value = 0.88
L(bsdf.outputs['BSDF'], out.inputs['Surface'])


def make_pillar(seed, kind):
    """一根石柱的网格：kind=0 尖锥、1 墓碑形（扁、顶圆）、2 矮墩。高度归一成 1，放置时再缩放"""
    rnd = random.Random(seed); rings, segs = 56, 48; vs = []
    for r in range(rings + 1):
        t = r / rings
        if kind == 0: rad = 0.30 * (1 - t) ** 0.75 + 0.02
        elif kind == 1: rad = 0.26 * (1 - t ** 3.5) ** 0.5 + 0.01
        else: rad = 0.34 * (1 - t ** 2.2) ** 0.6 + 0.01
        rad *= 1.25 - 0.25 * min(1, t * 6)            # 根部略收
        for s in range(segs):
            ang = 2 * math.pi * s / segs
            x, y = math.cos(ang) * rad, math.sin(ang) * rad * (0.55 if kind == 1 else 1.0)
            p = Vector((x * 2.2, y * 2.2, t * 2.2 + seed * 7.3))
            d = 1 + 0.40 * noise.noise(p) + 0.18 * noise.noise(p * 3.1) + 0.09 * noise.noise(p * 8) + 0.04 * noise.noise(p * 21)
            d -= 0.16 * max(0, noise.noise(p * 5.3 + Vector((9, 9, 9))) - 0.25)   # 风蚀孔洞
            # 风蚀的横向凹槽
            d *= 1 - 0.10 * max(0, math.sin(t * rnd.uniform(18, 26) + rnd.random() * 6)) ** 4
            lean = 0.06 * t * t
            vs.append((x * d + lean * math.cos(seed), y * d + lean * math.sin(seed), t - 0.12))   # 埋进沙里 12%
    vs.append((0.06 * math.cos(seed), 0.06 * math.sin(seed), 1.0 - 0.12 + 0.01)); top = len(vs) - 1
    fs = [(r * segs + s, r * segs + (s + 1) % segs, (r + 1) * segs + (s + 1) % segs, (r + 1) * segs + s) for r in range(rings) for s in range(segs)]
    fs += [(rings * segs + s, rings * segs + (s + 1) % segs, top) for s in range(segs)]
    me = bpy.data.meshes.new(f'pillar{seed}'); me.from_pydata(vs, [], fs)
    for p in me.polygons: p.use_smooth = True
    me.materials.append(rock)
    return me


protos = [make_pillar(i, k) for i, k in enumerate([0, 0, 0, 1, 1, 2, 0, 1, 2, 0])]


def place(x, y, h, rot, proto, wide=1.0):
    o = bpy.data.objects.new('p', proto); o.location = (x, y, height(x, y)); o.rotation_euler = (0, 0, rot)
    o.scale = (h * wide, h * wide, h); sc.collection.objects.link(o)


# 相机走廊：沿 +Y 前进，x≈0；走廊里不放柱子，两侧放大柱
def in_path(x, y): return abs(x - 1.2 * math.sin(y * 0.05)) < 2.6 and -40 < y < 30

# 主景：前方一组高柱（最高 3.5 m）
hero = [(-3.6, 3, 3.5, 0), (3.4, 5, 3.1, 3), (-6.5, 8, 2.6, 6), (5.8, 0, 2.3, 4), (-3.0, 12, 2.9, 1), (4.2, 13, 3.3, 9), (-7.5, -2, 1.9, 5), (7.5, 9, 2.7, 7), (-4.2, -7, 2.2, 2), (4.0, -9, 1.7, 8), (1.2, 22, 3.4, 0), (-2.2, 26, 2.8, 3), (-9.5, 14, 3.0, 6), (9.5, 18, 2.4, 1), (-5.5, 20, 2.0, 4), (6.5, 24, 3.2, 3), (-3.4, -13, 1.4, 5), (3.6, -15, 1.2, 2)]
for x, y, h, i in hero: place(x, y, h, random.random() * 6.28, protos[i], random.uniform(0.95, 1.25))
# 成千根散布到地平线（密度随机成簇）
count = 0
while count < 2600:
    x, y = random.uniform(-230, 230), random.uniform(-60, 240)
    if in_path(x, y) or abs(x) < 10 and -10 < y < 32: continue
    if noise.noise(Vector((x * 0.03, y * 0.03, 9.0))) < -0.12: continue      # 留出空沙地
    h = min(3.5, random.lognormvariate(-0.15, 0.55)); h = max(0.25, h)
    place(x, y, h, random.random() * 6.28, random.choice(protos), random.uniform(0.75, 1.2)); count += 1

# 中景加密：镜头前 15–130 m 再补一批，才有「成片」的感觉
count = 0
while count < 1400:
    x, y = random.uniform(-130, 130), random.uniform(14, 130)
    if in_path(x, y) or noise.noise(Vector((x * 0.05, y * 0.05, 4.0))) < -0.05: continue
    h = max(0.3, min(3.5, random.lognormvariate(0.0, 0.5)))
    place(x, y, h, random.random() * 6.28, random.choice(protos), random.uniform(0.75, 1.15)); count += 1

# ---------- 天空、太阳、薄雾 ----------
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; nt = w.node_tree; nt.nodes.clear()
out = nt.nodes.new('ShaderNodeOutputWorld'); bg = nt.nodes.new('ShaderNodeBackground'); sky = nt.nodes.new('ShaderNodeTexSky')
SUN_EL, SUN_AZ = math.radians(5.5), math.radians(-62)      # 太阳在左前方、贴近地平线：侧逆光，长影横过沙面
for t in ('MULTIPLE_SCATTERING', 'NISHITA'):
    try: sky.sky_type = t; break
    except TypeError: pass
sky.sun_elevation = SUN_EL; sky.sun_rotation = SUN_AZ
for k, v in (('air_density', 1.6), ('aerosol_density', 2.2), ('dust_density', 2.2), ('ozone_density', 1.5), ('sun_intensity', 0.25), ('sun_size', math.radians(1.6))):
    if hasattr(sky, k): setattr(sky, k, v)
bg.inputs['Strength'].default_value = 0.42
nt.links.new(sky.outputs['Color'], bg.inputs['Color']); nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
# 太阳灯：暖色、低角度、柔边长影（天空纹理里的日盘只管观感，主光用灯便于控制）
sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 6.0; sun.color = (1.0, 0.55, 0.26); sun.angle = math.radians(2.5)
so = bpy.data.objects.new('sun', sun); sc.collection.objects.link(so)
# 灯朝向 = 从太阳方向照过来（天空的 sun_rotation 绕 Z、0 在 +Y）
d = Vector((math.sin(-SUN_AZ) * math.cos(SUN_EL), math.cos(SUN_AZ) * math.cos(SUN_EL), math.sin(SUN_EL)))
so.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
# 贴地薄雾：让远处石柱一层层淡出去，沙尘被逆光打亮
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 90, 6)); fog = bpy.context.object; fog.scale = (480, 480, 14)
fm = bpy.data.materials.new('fog'); fm.use_nodes = True; nt = fm.node_tree; nt.nodes.clear()
out = nt.nodes.new('ShaderNodeOutputMaterial'); vol = nt.nodes.new('ShaderNodeVolumePrincipled')
vol.inputs['Density'].default_value = 0.0007; vol.inputs['Anisotropy'].default_value = 0.55; vol.inputs['Color'].default_value = (1.0, 0.82, 0.62, 1)
nt.links.new(vol.outputs['Volume'], out.inputs['Volume']); fog.data.materials.append(fm)

# ---------- 云：高空几层带噪声透明度的薄片，日落从下方打亮 ----------
cm = bpy.data.materials.new('cloud'); cm.use_nodes = True; nt = cm.node_tree; nt.nodes.clear()
out = nt.nodes.new('ShaderNodeOutputMaterial'); tc = nt.nodes.new('ShaderNodeNewGeometry'); mp = nt.nodes.new('ShaderNodeMapping')
mp.inputs['Scale'].default_value = (1.0, 2.6, 1.0)
cn = nt.nodes.new('ShaderNodeTexNoise'); cn.inputs['Scale'].default_value = 0.0006; cn.inputs['Detail'].default_value = 9.0; cn.inputs['Roughness'].default_value = 0.6
cr = nt.nodes.new('ShaderNodeValToRGB'); cr.color_ramp.elements[0].position = 0.50; cr.color_ramp.elements[1].position = 0.68
em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (1.0, 0.36, 0.22, 1); em.inputs['Strength'].default_value = 2.2
tr = nt.nodes.new('ShaderNodeBsdfTransparent'); mx = nt.nodes.new('ShaderNodeMixShader')
L = nt.links.new
L(tc.outputs['Position'], mp.inputs['Vector']); L(mp.outputs['Vector'], cn.inputs['Vector']); L(cn.outputs['Fac'], cr.inputs['Fac'])
L(cr.outputs['Color'], mx.inputs['Fac']); L(tr.outputs['BSDF'], mx.inputs[1]); L(em.outputs['Emission'], mx.inputs[2]); L(mx.outputs['Shader'], out.inputs['Surface'])
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 4000, 900)); cl = bpy.context.object; cl.scale = (24000, 24000, 1); cl.data.materials.append(cm)
cl.visible_shadow = False
# 云缓慢平移（5 秒里漂一点）
cl.keyframe_insert('location', frame=1); cl.location.x += 110; cl.keyframe_insert('location', frame=FRAMES)

# ---------- 相机：贴近沙面起步，沿走廊推进并略微升起，始终看向主柱群 ----------
cam = bpy.data.cameras.new('cam'); cam.lens = 26; cam.clip_end = 30000; cam.sensor_width = 36; cam.dof.use_dof = True; cam.dof.aperture_fstop = 8.0
co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co); sc.camera = co
tgt = bpy.data.objects.new('tgt', None); sc.collection.objects.link(tgt); cam.dof.focus_object = tgt
con = co.constraints.new('TRACK_TO'); con.target = tgt; con.track_axis = 'TRACK_NEGATIVE_Z'; con.up_axis = 'UP_Y'
for f in range(1, FRAMES + 1):
    t = (f - 1) / (FRAMES - 1); e = t * t * (3 - 2 * t) * 0.85 + t * 0.15          # 缓入缓出
    y = -20 + 16 * e; x = 1.2 * math.sin(y * 0.05)
    co.location = (x, y, height(x, y) + 1.15 + 1.1 * e); co.keyframe_insert('location', frame=f)
    tgt.location = (-0.8 + 0.5 * e, 10 + 6 * e, 1.7); tgt.keyframe_insert('location', frame=f)
for o in (co, tgt, cl):
    for fc in (o.animation_data.action.fcurves if hasattr(o.animation_data.action, 'fcurves') else []):
        for k in fc.keyframe_points: k.interpolation = 'LINEAR'

sc.render.image_settings.file_format = 'PNG'
if a.still is not None:
    sc.frame_set(a.still); sc.render.filepath = f'{a.out}/still_{a.still:03d}.png'; bpy.ops.render.render(write_still=True)
if a.anim:
    sc.render.filepath = f'{a.out}/f_'; bpy.ops.render.render(animation=True)
