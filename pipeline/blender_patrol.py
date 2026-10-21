"""Runs INSIDE Blender: Amir's black Nissan Patrol Y60 (5-door), built up for
off-road (same dimensions as src/game/vehicles/Patrol.js), exported as .glb.

    blender -b --factory-startup -P pipeline/blender_patrol.py -- <out.glb>

Bevelled body panels with real wheel-arch cut-outs and flares, glass
greenhouse with body-colour pillars and roof, slatted black grille with
round lights (chrome bezels, domed lenses, LED halo rings), steel bumper
with hoop bar and fog lights, snorkel, side steps, mirrors, door seams and
handles, mud-terrain tyres with real tread blocks on black steel wheels,
swing-out spare, ladder, roof basket with a tarp and a jerry can, seats,
dashboard and steering wheel inside, chassis and axles underneath.
Named objects the game uses: halo (headlight rings), plate_front.
"""
import math
import os
import random
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit as K  # noqa: E402

OUT = sys.argv[sys.argv.index("--") + 1]
K.reset()
random.seed(5)

WB, TR, TW, TRACK = 2.97, 0.43, 0.31, 0.83
FRONT, REAR = 2.22, -2.22
SILL, BELT, ROOF, WIDTH = 0.7, 1.4, 2.0, 1.9
AF, AR = WB / 2, -WB / 2  # axle z

paint = K.flat("paint", (0.012, 0.013, 0.015), roughness=0.3, metallic=0.45)
bsdf = paint.node_tree.nodes["Principled BSDF"]
for k in ("Coat Weight", "Clearcoat"):
    if k in bsdf.inputs:
        bsdf.inputs[k].default_value = 0.7
matte = K.flat("matte", (0.02, 0.02, 0.022), roughness=0.7, metallic=0.3)
plastic = K.flat("plastic", (0.012, 0.012, 0.013), roughness=0.62)
glass = K.flat("glass", (0.02, 0.028, 0.034), roughness=0.04, metallic=0.35)
chrome = K.flat("chrome", (0.8, 0.8, 0.82), roughness=0.14, metallic=1.0)
alu = K.flat("alu", (0.6, 0.62, 0.64), roughness=0.35, metallic=0.9)
rubber = K.flat("rubber", (0.028, 0.028, 0.028), roughness=0.92)
lens = K.flat("lens", (0.75, 0.78, 0.82), roughness=0.05, metallic=0.5)
red = K.flat("red", (0.35, 0.015, 0.015), roughness=0.2)
amber = K.flat("amber", (0.8, 0.42, 0.05), roughness=0.25)
fabric = K.flat("fabric", (0.03, 0.03, 0.033), roughness=0.95)
tarp = K.flat("tarp", (0.11, 0.15, 0.07), roughness=0.85)
jerry = K.flat("jerry", (0.14, 0.19, 0.09), roughness=0.55, metallic=0.2)
white = K.flat("plate", (0.9, 0.9, 0.88), roughness=0.5)
halo_m = K.flat("halo_mat", (0.5, 0.5, 0.5), roughness=0.3)

objs = []


def keep(o):
    objs.append(o)
    return o


# ======================= body ===============================================
body_profile = [
    (FRONT - 0.02, 0.66), (FRONT, 0.8), (FRONT, 1.19), (FRONT - 0.05, 1.3), (FRONT - 0.2, 1.345),
    (0.95, 1.375), (0.86, BELT), (REAR + 0.03, BELT), (REAR, 1.36), (REAR, 0.72), (REAR + 0.05, 0.66),
]
body = K.profile_extrude("body", body_profile, -WIDTH / 2, WIDTH / 2, paint)
for az in (AF, AR):
    cutter = K.cyl_obj("arch", (-1.5, TR, az), (1.5, TR, az), 0.53, plastic, seg=40)
    K.boolean_cut(body, cutter)
K.bevel_mod(body, 0.045, 3)
keep(body)

# greenhouse glass and the body-colour roof, pillars and frames
gh = K.profile_extrude("greenhouse", [(0.86, BELT - 0.01), (0.52, ROOF - 0.04), (REAR + 0.1, ROOF - 0.04), (REAR + 0.03, BELT - 0.01)],
                       -WIDTH / 2 + 0.07, WIDTH / 2 - 0.07, glass)
K.bevel_mod(gh, 0.03, 2)
keep(gh)
keep(K.box_obj("roof", (0, ROOF - 0.005, (0.52 + REAR + 0.1) / 2), (WIDTH - 0.1, 0.06, 0.52 - REAR - 0.1 + 0.08), paint, bevel=0.025))
for s in (-1, 1):
    x = s * (WIDTH / 2 - 0.065)
    for z0, y0, z1, y1, w in ((0.86, BELT, 0.5, ROOF - 0.03, 0.09), (-0.28, BELT, -0.28, ROOF - 0.03, 0.11),
                              (-1.28, BELT, -1.26, ROOF - 0.03, 0.12), (REAR + 0.06, BELT, REAR + 0.1, ROOF - 0.03, 0.13)):
        ln = math.hypot(z1 - z0, y1 - y0)
        keep(K.box_obj("pillar", (x, (y0 + y1) / 2, (z0 + z1) / 2), (0.05, ln, w), paint, rot=(math.atan2(z1 - z0, y1 - y0) * -1 * -1, 0, 0), bevel=0.012))
    # window frame along the roof edge, rubber belt strip
    keep(K.box_obj("frame_top", (x, ROOF - 0.06, (0.5 + REAR + 0.1) / 2), (0.05, 0.05, 0.5 - REAR - 0.1), paint, bevel=0.01))
    keep(K.box_obj("belt_strip", (x + s * 0.012, BELT + 0.01, (0.86 + REAR) / 2), (0.03, 0.03, 0.86 - REAR - 0.06), plastic))
    # door seams (thin dark gaps) and chrome handles
    for z in (0.9, -0.27, -1.27):
        keep(K.box_obj("seam", (s * (WIDTH / 2 + 0.002), (SILL + BELT) / 2 + 0.02, z), (0.008, BELT - SILL - 0.08, 0.008), plastic))
    for z in (0.02, -0.98):
        keep(K.box_obj("handle", (s * (WIDTH / 2 + 0.012), 1.22, z), (0.025, 0.035, 0.16), chrome, bevel=0.008))
    # mirrors on short arms
    keep(K.box_obj("mirror", (s * (WIDTH / 2 + 0.12), BELT + 0.1, 0.72), (0.06, 0.17, 0.23), plastic, bevel=0.02))
    keep(K.box_obj("mirror_glass", (s * (WIDTH / 2 + 0.12), BELT + 0.1, 0.6), (0.045, 0.14, 0.005), glass))
    keep(K.box_obj("mirror_arm", (s * (WIDTH / 2 + 0.05), BELT + 0.05, 0.76), (0.14, 0.03, 0.05), plastic, bevel=0.008))
    # side steps (aluminium) with black brackets
    keep(K.box_obj("step", (s * (WIDTH / 2 + 0.07), 0.56, -0.02), (0.22, 0.04, 2.0), alu, bevel=0.01))
    for z in (0.7, -0.7):
        keep(K.box_obj("step_bracket", (s * (WIDTH / 2 - 0.02), 0.6, z), (0.14, 0.12, 0.05), plastic))
    # fender flares around both arches
    for az in (AF, AR):
        pts = [(s * (WIDTH / 2 + 0.015), TR + 0.56 * math.sin(a), az + 0.56 * math.cos(a)) for a in [math.pi * i / 10 for i in range(11)]]
        keep(K.curve_tube("flare", pts, 0.05, plastic, resolution=6))

# windscreen cowl & wipers, hood bulge, emblem
keep(K.box_obj("cowl", (0, BELT + 0.005, 0.86), (WIDTH - 0.1, 0.04, 0.08), plastic))
for x in (-0.35, 0.3):
    keep(K.box_obj("wiper", (x, BELT + 0.04, 0.8), (0.55, 0.012, 0.02), plastic, rot=(0, 0, 0.12)))
keep(K.box_obj("hood_bulge", (0, 1.37, 1.55), (1.0, 0.04, 1.1), paint, rot=(0.035, 0, 0), bevel=0.018))
keep(K.cyl_obj("emblem", (0, 1.33, FRONT - 0.07), (0, 1.33, FRONT - 0.04), 0.03, chrome))

# ======================= front ==============================================
keep(K.box_obj("grille", (0, 1.03, FRONT + 0.01), (WIDTH - 0.12, 0.34, 0.04), plastic, bevel=0.01))
for i in range(5):
    keep(K.box_obj("slat", (0, 0.9 + i * 0.065, FRONT + 0.035), (0.9, 0.025, 0.05), matte))
halos = []
for s in (-1, 1):
    hx = s * 0.62
    keep(K.cyl_obj("lamp_housing", (hx, 1.03, FRONT), (hx, 1.03, FRONT + 0.06), 0.13, plastic, seg=32))
    keep(K.cyl_obj("bezel", (hx, 1.03, FRONT + 0.05), (hx, 1.03, FRONT + 0.065), 0.112, chrome, seg=32, r1=0.104))
    keep(K.lathe("lens", [(0.0, 0.035), (0.05, 0.03), (0.085, 0.017), (0.103, 0.0)], lens, segments=32, center=(hx, 1.03, FRONT + 0.06), axis="z"))
    ring = [(hx + 0.092 * math.cos(a), 1.03 + 0.092 * math.sin(a), FRONT + 0.075) for a in [2 * math.pi * i / 24 for i in range(24)]]
    halos.append(K.curve_tube("halo", ring, 0.008, halo_m, resolution=4, closed=True))
    keep(K.box_obj("indicator", (s * 0.84, 0.86, FRONT + 0.02), (0.14, 0.05, 0.03), amber, bevel=0.008))
# steel bumper, skid plate, hoop bar, fog lights, recovery points
keep(K.box_obj("bumper", (0, 0.7, FRONT + 0.16), (WIDTH + 0.06, 0.32, 0.26), matte, bevel=0.03))
keep(K.box_obj("skid", (0, 0.5, FRONT + 0.1), (WIDTH - 0.2, 0.08, 0.32), matte, bevel=0.01))
keep(K.curve_tube("hoop", [(-0.72, 0.86, FRONT + 0.2), (-0.68, 1.22, FRONT + 0.24), (0, 1.32, FRONT + 0.26), (0.68, 1.22, FRONT + 0.24), (0.72, 0.86, FRONT + 0.2)], 0.032, matte))
for x in (-0.3, 0.3):
    keep(K.curve_tube("hoop_up", [(x, 0.86, FRONT + 0.22), (x, 1.3, FRONT + 0.25)], 0.024, matte))
for s in (-1, 1):
    keep(K.cyl_obj("fog", (s * 0.78, 0.7, FRONT + 0.29), (s * 0.78, 0.7, FRONT + 0.34), 0.06, plastic))
    keep(K.cyl_obj("fog_lens", (s * 0.78, 0.7, FRONT + 0.335), (s * 0.78, 0.7, FRONT + 0.345), 0.047, lens))
    keep(K.box_obj("shackle", (s * 0.45, 0.57, FRONT + 0.31), (0.03, 0.06, 0.06), red, bevel=0.01))
bm = bmesh.new()
uvl = bm.loops.layers.uv.verify()
pz = FRONT + 0.296
vs = [bm.verts.new(K.B(x, y, pz)) for x, y in ((-0.31, 0.6525), (0.21, 0.6525), (0.21, 0.7675), (-0.31, 0.7675))]
f = bm.faces.new(vs)
for loop, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
    loop[uvl].uv = uv
plate = K.new_obj("plate_front", bm, white)

# snorkel up the left A-pillar (left = +X)
keep(K.curve_tube("snorkel", [(0.985, 1.28, 1.3), (1.0, 1.52, 1.02), (0.995, 1.82, 0.74), (0.975, 2.06, 0.6)], 0.055, plastic))
keep(K.box_obj("snorkel_head", (0.92, 2.1, 0.58), (0.16, 0.16, 0.22), plastic, rot=(0.2, 0, 0), bevel=0.03))
keep(K.box_obj("snorkel_base", (0.97, 1.2, 1.28), (0.06, 0.32, 0.2), plastic, bevel=0.01))

# ======================= wheels =============================================
tyre_profile = [(0.27, -0.15), (0.33, -0.156), (0.395, -0.152), (0.42, -0.136), (0.43, -0.1), (0.432, 0.0),
                (0.43, 0.1), (0.42, 0.136), (0.395, 0.152), (0.33, 0.156), (0.27, 0.15)]
rim_profile = [(0.0, 0.07), (0.05, 0.07), (0.1, 0.06), (0.17, 0.035), (0.22, 0.03), (0.255, 0.02), (0.268, 0.0),
               (0.27, -0.06), (0.268, -0.13), (0.255, -0.14)]


def wheel(center, axis, yaw=0.0, outward=1):
    parts = []
    t = K.lathe("tyre", tyre_profile, rubber, segments=40, center=(0, 0, 0), axis="x")
    parts.append(t)
    r = K.lathe("rim", [(rr, -o * outward) for rr, o in rim_profile], matte, segments=36, center=(0, 0, 0), axis="x")
    for k in range(6):
        a = 2 * math.pi * k / 6
        cutter = K.cyl_obj("hole", (-0.3, 0.17 * math.sin(a), 0.17 * math.cos(a)), (0.3, 0.17 * math.sin(a), 0.17 * math.cos(a)), 0.036, matte, seg=14)
        K.boolean_cut(r, cutter)
    parts.append(r)
    parts.append(K.cyl_obj("hub", (outward * 0.06, 0, 0), (outward * 0.085, 0, 0), 0.06, chrome, seg=20))
    # tread blocks: two staggered rows + shoulder lugs
    bm = bmesh.new()
    n = 30
    for k in range(n):
        for row, (xo, w) in enumerate(((-0.065, 0.1), (0.065, 0.1), (-0.135, 0.05), (0.135, 0.05))):
            a = 2 * math.pi * (k + (0.5 if row % 2 else 0.0)) / n
            rad = 0.437 if row < 2 else 0.418
            K.bm_obox(bm, (xo, rad * math.sin(a), rad * math.cos(a)), (w, 0.022, 0.06 if row < 2 else 0.05), (-a, 0, 0))
    parts.append(K.new_obj("tread", bm, rubber))
    for p in parts:  # bake each part's own orientation into its mesh before joining
        bpy.ops.object.select_all(action="DESELECT")
        p.select_set(True)
        bpy.context.view_layer.objects.active = p
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    grp = K.join(parts, "wheel")
    # steer (yaw about the vertical axis), then move into place
    grp.rotation_mode = "XYZ"
    grp.rotation_euler = (0, 0, -yaw)
    grp.location = K.B(*center)
    return grp


for s in (-1, 1):
    keep(wheel((s * TRACK, TR, AF), "x", yaw=0.18, outward=s))
    keep(wheel((s * TRACK, TR, AR), "x", outward=s))
# swing-out spare on the back (axis along z)
spare = wheel((0.18, 1.15, REAR - 0.3), "x", outward=1)
spare.rotation_euler = (0, 0, math.pi / 2)
keep(spare)
keep(K.box_obj("spare_carrier", (0.18, 1.15, REAR - 0.12), (0.12, 0.5, 0.14), matte, bevel=0.01))

# ======================= rear, ladder, roof basket ==========================
for s in (-1, 1):
    keep(K.box_obj("tail", (s * 0.86, 1.15, REAR - 0.02), (0.12, 0.3, 0.03), red, bevel=0.01))
keep(K.box_obj("rear_bumper", (0, 0.66, REAR - 0.05), (WIDTH + 0.02, 0.18, 0.16), matte, bevel=0.02))
lx, lz = 0.78, REAR - 0.06
for dx in (-0.12, 0.12):
    keep(K.curve_tube("ladder_rail", [(lx + dx, 0.75, lz), (lx + dx, ROOF + 0.18, lz)], 0.016, matte))
y = 0.85
while y < ROOF + 0.1:
    keep(K.curve_tube("ladder_rung", [(lx - 0.12, y, lz), (lx + 0.12, y, lz)], 0.012, matte))
    y += 0.24
bx, bz0, bz1, by = WIDTH / 2 - 0.1, -2.12, 0.42, ROOF + 0.2
frame = [(-bx, by, bz0), (bx, by, bz0), (bx, by, bz1), (-bx, by, bz1), (-bx, by, bz0)]
for a, b in zip(frame, frame[1:]):
    keep(K.curve_tube("basket", [a, b], 0.018, matte))
for x in (-bx, bx):
    keep(K.curve_tube("basket_top", [(x, by + 0.12, bz0), (x, by + 0.12, bz1)], 0.014, matte))
    for z in [bz0 + (bz1 - bz0) * i / 6 for i in range(7)]:
        keep(K.curve_tube("basket_post", [(x, by, z), (x, by + 0.12, z)], 0.012, matte))
z = bz0 + 0.25
while z < bz1:
    keep(K.curve_tube("basket_bar", [(-bx, by, z), (bx, by, z)], 0.011, matte))
    z += 0.3
for x in (-bx + 0.05, bx - 0.05):
    for z in (bz0 + 0.2, bz1 - 0.2):
        keep(K.box_obj("basket_foot", (x, ROOF + 0.09, z), (0.05, 0.18, 0.08), matte))
keep(K.cyl_obj("tarp_roll", (-0.6, by + 0.13, -1.5), (0.4, by + 0.13, -1.5), 0.12, tarp, seg=20))
keep(K.box_obj("jerry_can", (0.55, by + 0.18, -0.7), (0.17, 0.34, 0.47), jerry, bevel=0.025))

# ======================= interior & underneath ==============================
for z, w in ((0.15, 0.62), (-0.95, 1.45)):
    for x in ((-0.42, 0.42) if w < 1 else (0.0,)):
        keep(K.box_obj("seat", (x, 0.95, z), (w, 0.14, 0.55), fabric, bevel=0.04))
        keep(K.box_obj("seat_back", (x, 1.3, z - 0.27), (w, 0.6, 0.12), fabric, rot=(-0.12, 0, 0), bevel=0.04))
keep(K.box_obj("dash", (0, 1.3, 0.72), (WIDTH - 0.2, 0.22, 0.3), plastic, bevel=0.03))
sw = [(0.42 + 0.18 * math.cos(a), 1.38 + 0.18 * math.sin(a) * 0.95, 0.55 + 0.05 * math.sin(a)) for a in [2 * math.pi * i / 20 for i in range(20)]]
keep(K.curve_tube("steering", sw, 0.018, plastic, closed=True))
keep(K.box_obj("chassis", (0, 0.55, 0), (1.2, 0.26, 4.0), plastic))
for az in (AF, AR):
    keep(K.cyl_obj("axle", (-TRACK + 0.1, TR, az), (TRACK - 0.1, TR, az), 0.05, matte))
    keep(K.lathe("diff", [(0.0, 0.14), (0.1, 0.1), (0.14, 0.0), (0.1, -0.1), (0.0, -0.14)], matte, segments=16, center=(0.1, TR, az), axis="x"))
keep(K.curve_tube("exhaust", [(-0.5, 0.48, 0.8), (-0.55, 0.47, -1.0), (-0.6, 0.5, REAR - 0.05)], 0.035, matte))

# ======================= merge by material, bake, export ====================
by_mat = {}
for o in objs:
    for m in o.data.materials:
        pass
    key = o.data.materials[0].name if o.data.materials else "none"
    by_mat.setdefault(key, []).append(o)
final = []
for key, group in by_mat.items():
    # apply object transforms before joining
    for o in group:
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    final.append(K.join(group, key))
halo = K.join(halos, "halo")
for o in final:
    print("tris", o.name, K.tris(o))
K.bake_ao(final, distance=0.6, samples=24, strength=0.75)
K.export_glb(OUT)
