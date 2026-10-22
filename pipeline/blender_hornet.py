"""Runs INSIDE Blender: Honda Hornet 2.0 (184 cc naked street bike) in matte
blue, exported as .glb (same frame as src/game/vehicles/Hornet.js: front
toward +Z, ground at y = 0, left = +X, wheelbase 1.36 m, 17" wheels).

    blender -b --factory-startup -P pipeline/blender_hornet.py -- <out.glb>

Bodywork is modelled from real side profiles (extruded, bevelled and
subdivided like production panels): the muscular tank, the big angular
shrouds that sweep forward and down, the stepped split seat, the sharp
upswept tail. Mechanicals: single-cylinder engine with finned barrel and
round side covers, diamond frame, gold upside-down fork with black lower
legs, Y-spoke alloy wheels with blue rim tape and petal discs, box-section
swingarm, monoshock, short right-side exhaust, compact LED headlight with
flyscreen, tapered handlebar with grips, levers and mirrors, footpegs,
rear grab rack and hugger. The front end is turned on the raked steering
axis and the bike leans onto its side stand.
Named objects the game uses: decal_L, decal_R (the HORNET graphic).
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit as K  # noqa: E402

OUT = sys.argv[sys.argv.index("--") + 1]
K.reset()

R = 0.3
FA, RA = (0, R, 0.68), (0, R, -0.68)
HEAD = (0, 0.92, 0.45)
PIVOT = (0, 0.4, -0.16)

blue = K.flat("blue", (0.02, 0.07, 0.3), roughness=0.5, metallic=0.35)
gold = K.flat("gold", (0.85, 0.58, 0.18), roughness=0.28, metallic=1.0)
black = K.flat("black", (0.012, 0.012, 0.014), roughness=0.38, metallic=0.3)
matte = K.flat("matte_black", (0.02, 0.02, 0.02), roughness=0.75)
grey = K.flat("grey", (0.2, 0.21, 0.22), roughness=0.45, metallic=0.35)
alu = K.flat("alu", (0.55, 0.56, 0.58), roughness=0.3, metallic=0.95)
steel = K.flat("steel", (0.7, 0.71, 0.72), roughness=0.22, metallic=1.0)
rubber = K.flat("rubber", (0.03, 0.03, 0.03), roughness=0.9)
tape = K.flat("rim_tape", (0.04, 0.18, 0.75), roughness=0.4)
redl = K.flat("taillight", (0.4, 0.02, 0.02), roughness=0.2)
lens = K.flat("lens", (0.8, 0.82, 0.86), roughness=0.05, metallic=0.4)
seat_m = K.flat("seat", (0.022, 0.022, 0.024), roughness=0.85)
decal_m = K.flat("decal", (1, 1, 1), roughness=0.5)

body, front = [], []


def panel(name, prof, x0, x1, mat, bevel=0.02, levels=2, taper=None, tilt_out=0.0):
    """side profile [(z, y)] extruded between x0..x1, bevelled and subdivided.
    taper(z) -> width factor (narrower toward the tail / nose)."""
    ob = K.profile_extrude(name, prof, x0, x1, mat)
    if taper:
        xc = (x0 + x1) / 2
        for v in ob.data.vertices:
            z = -v.co.y  # Blender -y = game z
            v.co.x = xc + (v.co.x - xc) * taper(z)
    if tilt_out:
        ob.data.transform(Matrix.Rotation(tilt_out, 4, "Y"))
    if bevel:
        K.bevel_mod(ob, bevel, 3, angle_deg=30)
    if levels:
        m = ob.modifiers.new("subd", "SUBSURF")
        m.levels = levels
        K.apply_mods(ob)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def wheel(center, width, front_wheel, out):
    parts = []
    hw = width / 2
    tyre = [(0.215, -hw * 0.85), (0.245, -hw), (0.28, -hw * 0.88), (0.296, -hw * 0.5), (0.3, 0.0), (0.296, hw * 0.5),
            (0.28, hw * 0.88), (0.245, hw), (0.215, hw * 0.85)]
    parts.append(K.lathe("tyre", tyre, rubber, segments=48, axis="x"))
    parts.append(K.lathe("rim", [(0.212, -hw * 0.72), (0.218, -hw * 0.6), (0.218, hw * 0.6), (0.212, hw * 0.72)], black, segments=48, axis="x"))
    parts.append(K.lathe("tape", [(0.219, -hw * 0.45), (0.2195, hw * 0.45)], tape, segments=48, axis="x"))
    parts.append(K.lathe("hub", [(0.0, 0.065), (0.035, 0.065), (0.05, 0.03), (0.05, -0.03), (0.035, -0.065), (0.0, -0.065)], black, segments=20, axis="x"))
    bm = bmesh.new()
    for k in range(5):  # Y-spokes
        a = 2 * math.pi * k / 5
        K.bm_obox(bm, (0, 0.09 * math.sin(a), 0.09 * math.cos(a)), (0.022, 0.1, 0.026), (math.pi / 2 - a, 0, 0))
        for da in (0.2, -0.2):  # each spoke forks in two toward the rim
            aa = a + da
            K.bm_obox(bm, (0, 0.175 * math.sin(aa), 0.175 * math.cos(aa)), (0.018, 0.085, 0.02), (math.pi / 2 - (a + da * 0.5), 0, 0))
    parts.append(K.new_obj("spokes", bm, black))
    # petal disc on the outside with a gold (front) / black (rear) caliper
    rd = 0.15 if front_wheel else 0.11
    disc = K.lathe("disc", [(rd - 0.035, out * 0.06), (rd, out * 0.06)], steel, segments=36, axis="x")
    sol = disc.modifiers.new("t", "SOLIDIFY")
    sol.thickness = 0.005
    K.apply_mods(disc)
    for v in disc.data.vertices:  # petal (wavy) edge
        rr = math.hypot(v.co.y, v.co.z)
        if rr > rd * 0.9:
            ang = math.atan2(v.co.z, v.co.y)
            k = 1 + 0.06 * math.sin(ang * 12)
            v.co.y *= k
            v.co.z *= k
    parts.append(disc)
    parts.append(K.box_obj("caliper", (out * 0.072, rd * 0.72, -rd * 0.66 if front_wheel else rd * 0.66),
                           (0.035, 0.09, 0.06), gold if front_wheel else black, bevel=0.012))
    for p in parts:
        bpy.ops.object.select_all(action="DESELECT")
        p.select_set(True)
        bpy.context.view_layer.objects.active = p
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    w = K.join(parts, "wheel")
    w.location = K.B(*center)
    return w


# ======================= bodywork ===========================================
# fuel tank: high, muscular front, dropping to the seat
tank = panel("tank", [(0.37, 0.92), (0.33, 1.0), (0.22, 1.045), (0.08, 1.03), (-0.02, 0.94), (-0.04, 0.86),
                       (0.06, 0.83), (0.22, 0.85), (0.34, 0.86)], -0.165, 0.165, blue, bevel=0.05, levels=2,
             taper=lambda z: 0.72 + 0.28 * min(1.0, max(0.0, (z + 0.04) / 0.3)))
body.append(tank)
# side shrouds: big angular scoops sweeping forward and down from the tank
for s in (-1, 1):
    prof = [(0.06, 1.0), (0.3, 1.0), (0.47, 0.95), (0.54, 0.84), (0.46, 0.66), (0.34, 0.58), (0.16, 0.6), (0.04, 0.74)]
    x0, x1 = (0.12, 0.205) if s > 0 else (-0.205, -0.12)
    sh = panel("shroud", prof, x0, x1, blue, bevel=0.025, levels=2, tilt_out=-s * 0.1,
               taper=lambda z: 1.0 - 0.35 * min(1.0, max(0.0, (z - 0.3) / 0.25)))
    body.append(sh)
    # black inner scoop under each shroud
    inner = panel("shroud_in", [(0.36, 0.62), (0.5, 0.67), (0.53, 0.76), (0.44, 0.74), (0.3, 0.66)],
                  x0 - 0.02 * s, x1 - 0.03 * s, matte, bevel=0.008, levels=1)
    body.append(inner)
    # decal (HORNET graphic) laid on the outer face of the shroud
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.verify()
    xo = s * 0.212
    quad = [(xo, 0.69, 0.5), (xo, 0.79, 0.14), (xo, 0.9, 0.14), (xo, 0.8, 0.5)] if s > 0 else \
           [(xo, 0.79, 0.14), (xo, 0.69, 0.5), (xo, 0.8, 0.5), (xo, 0.9, 0.14)]
    vs = [bm.verts.new(K.B(*p)) for p in quad]
    f = bm.faces.new(vs)
    for loop, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uvl].uv = uv
    dec = K.new_obj("decal_L" if s > 0 else "decal_R", bm, decal_m)
    dec.data.transform(Matrix.Rotation(-s * 0.1, 4, "Y"))
    # dark grey side cover under the seat, black lower cowl under the shroud
    body.append(panel("side_cover", [(-0.04, 0.8), (-0.3, 0.8), (-0.36, 0.7), (-0.2, 0.62), (0.0, 0.64)],
                      s * 0.11, s * 0.135, grey, bevel=0.012, levels=1))
    body.append(panel("cowl", [(0.2, 0.62), (0.4, 0.58), (0.42, 0.5), (0.3, 0.46), (0.18, 0.52)],
                      s * 0.1, s * 0.16, matte, bevel=0.012, levels=1))
# stepped split seat
body.append(panel("seat_rider", [(-0.04, 0.88), (-0.1, 0.835), (-0.36, 0.81), (-0.4, 0.84), (-0.36, 0.78), (-0.04, 0.8)],
                   -0.13, 0.13, seat_m, bevel=0.025, levels=2, taper=lambda z: 0.85 + 0.15 * min(1.0, max(0.0, (z + 0.36) / 0.3))))
body.append(panel("seat_pillion", [(-0.4, 0.86), (-0.46, 0.885), (-0.66, 0.905), (-0.68, 0.875), (-0.6, 0.85), (-0.4, 0.83)],
                   -0.1, 0.1, seat_m, bevel=0.02, levels=2))
# sharp upswept tail (grey side panels over a black core)
body.append(panel("tail", [(-0.32, 0.8), (-0.62, 0.87), (-0.88, 0.94), (-0.86, 0.9), (-0.66, 0.8), (-0.4, 0.7)],
                   -0.12, 0.12, grey, bevel=0.015, levels=1, taper=lambda z: 0.45 + 0.55 * min(1.0, max(0.0, (z + 0.88) / 0.5))))
body.append(K.box_obj("taillight", (0, 0.89, -0.86), (0.1, 0.035, 0.03), redl, rot=(0.45, 0, 0), bevel=0.01))
body.append(K.box_obj("plate_holder", (0, 0.76, -0.9), (0.16, 0.12, 0.01), black, rot=(0.35, 0, 0)))
body.append(K.cyl_obj("plate_arm", (0, 0.86, -0.84), (0, 0.8, -0.9), 0.012, black, seg=8))
body.append(panel("hugger", [(-0.42, 0.62), (-0.6, 0.6), (-0.8, 0.5), (-0.78, 0.47), (-0.58, 0.57), (-0.42, 0.58)], -0.07, 0.07, matte, bevel=0.008, levels=1))
# big black luggage rack: flat top with slats, side guards down past the axle
for s in (-1, 1):
    body.append(K.curve_tube("rack_rail", [(s * 0.12, 0.86, -0.42), (s * 0.15, 0.95, -0.6), (s * 0.15, 0.97, -0.92)], 0.014, black))
    body.append(K.cyl_obj("guard_f", (s * 0.15, 0.94, -0.56), (s * 0.19, 0.56, -0.58), 0.013, black, seg=10))
    body.append(K.cyl_obj("guard_low", (s * 0.19, 0.56, -0.58), (s * 0.19, 0.56, -0.9), 0.013, black, seg=10))
    body.append(K.cyl_obj("guard_r", (s * 0.19, 0.56, -0.9), (s * 0.15, 0.96, -0.93), 0.013, black, seg=10))
    body.append(K.curve_tube("guard_bar", [(s * 0.19, 0.74, -0.58), (s * 0.2, 0.72, -0.76), (s * 0.19, 0.76, -0.94)], 0.01, black))
body.append(K.curve_tube("rack_back", [(-0.15, 0.97, -0.92), (0, 0.97, -0.97), (0.15, 0.97, -0.92)], 0.014, black))
for z in (-0.64, -0.72, -0.8, -0.88):
    body.append(K.box_obj("rack_slat", (0, 0.965, z), (0.3, 0.012, 0.025), black))

# ======================= frame, engine, exhaust =============================
for s in (-1, 1):
    body.append(K.curve_tube("frame", [(s * 0.05, 0.9, 0.42), (s * 0.12, 0.82, 0.22), (s * 0.13, 0.66, -0.02), (s * 0.09, 0.44, -0.15)], 0.022, black))
    body.append(K.curve_tube("downtube", [(s * 0.04, 0.84, 0.44), (s * 0.06, 0.5, 0.4), (s * 0.07, 0.24, 0.22), (s * 0.08, 0.2, 0.0)], 0.018, black))
    body.append(K.curve_tube("subframe", [(s * 0.1, 0.66, -0.12), (s * 0.1, 0.78, -0.4), (s * 0.08, 0.86, -0.72)], 0.013, black))
    # box-section swingarm to the rear axle
    ln = math.hypot(PIVOT[1] - R, PIVOT[2] - RA[2])
    body.append(K.box_obj("swingarm", (s * 0.105, (PIVOT[1] + R) / 2, (PIVOT[2] + RA[2]) / 2), (0.035, 0.055, ln + 0.05),
                          alu if False else black, rot=(-math.atan2(PIVOT[1] - R, PIVOT[2] - RA[2]), 0, 0), bevel=0.012))
    body.append(K.cyl_obj("footpeg", (s * 0.11, 0.33, -0.14), (s * 0.2, 0.33, -0.14), 0.013, steel, seg=10))
body.append(K.box_obj("chain_guard", (0.13, 0.4, -0.38), (0.012, 0.06, 0.42), matte, rot=(-0.17, 0, 0), bevel=0.01))
body.append(K.cyl_obj("shock", (0, 0.44, -0.2), (0, 0.78, -0.36), 0.022, steel))
body.append(K.curve_tube("spring", [(0.03 * math.cos(t), 0.5 + t * 0.011, -0.23 - t * 0.0052 + 0.03 * math.sin(t)) for t in [i * 0.6 for i in range(36)]],
                         0.006, black, resolution=2, bevel_res=1))
# engine: crankcase from its side profile, finned barrel leaning forward, round covers
body.append(panel("crankcase", [(0.25, 0.5), (0.3, 0.36), (0.22, 0.2), (0.0, 0.16), (-0.18, 0.24), (-0.2, 0.4), (-0.08, 0.5)],
                   -0.12, 0.12, matte, bevel=0.03, levels=1))
for k in range(8):
    y = 0.5 + k * 0.03
    body.append(K.box_obj("fin", (0, y, 0.18 + (y - 0.5) * 0.3), (0.21 - k * 0.004, 0.012, 0.19 - k * 0.003), black, rot=(-0.3, 0, 0)))
body.append(K.box_obj("cyl_head", (0, 0.76, 0.25), (0.18, 0.08, 0.17), black, rot=(-0.3, 0, 0), bevel=0.02))
for s in (-1, 1):
    body.append(K.cyl_obj("side_cover", (s * 0.12, 0.32, 0.02), (s * 0.15, 0.32, 0.02), 0.11, alu if s > 0 else black, seg=32))
    body.append(K.cyl_obj("cover_ring", (s * 0.15, 0.32, 0.02), (s * 0.155, 0.32, 0.02), 0.06, black, seg=24))
body.append(K.curve_tube("header", [(0, 0.6, 0.33), (-0.03, 0.42, 0.37), (-0.07, 0.2, 0.2), (-0.1, 0.17, -0.02), (-0.15, 0.24, -0.16)], 0.021, black))
# short angular silencer on the right, kicked up
body.append(panel("silencer", [(-0.1, 0.26), (-0.32, 0.38), (-0.38, 0.47), (-0.34, 0.5), (-0.12, 0.36), (-0.06, 0.28)],
                   -0.22, -0.12, black, bevel=0.015, levels=1))
body.append(K.cyl_obj("tip", (-0.17, 0.46, -0.365), (-0.17, 0.48, -0.39), 0.025, steel))
# side stand on the left (+X), resting on the ground
body.append(K.curve_tube("stand", [(0.12, 0.3, -0.05), (0.2, 0.17, 0.02), (0.25, 0.045, 0.08)], 0.012, black))
body.append(wheel(RA, 0.15, False, -1))
for s in (-1, 1):  # blue axle and engine sliders
    body.append(K.cyl_obj("slider", (s * 0.12, R, RA[2]), (s * 0.17, R, RA[2]), 0.022, blue, seg=16))
    body.append(K.cyl_obj("slider", (s * 0.12, 0.24, 0.24), (s * 0.19, 0.24, 0.24), 0.026, blue, seg=16))

# ======================= front end (turned on the steering axis) ============
front.append(wheel(FA, 0.11, True, 1))
for s in (-1, 1):
    front.append(K.cyl_obj("fork_upper", (s * 0.085, HEAD[1] + 0.03, HEAD[2] - 0.01), (s * 0.085, 0.55, 0.57), 0.032, gold, seg=20))
    front.append(K.cyl_obj("fork_lower", (s * 0.085, 0.57, 0.565), (s * 0.085, R + 0.03, FA[2] - 0.005), 0.023, black, seg=16))
    front.append(K.box_obj("axle_lug", (s * 0.085, R, FA[2]), (0.045, 0.07, 0.06), black, bevel=0.01))
front.append(K.box_obj("clamp_top", (0, HEAD[1] + 0.03, HEAD[2] - 0.01), (0.25, 0.03, 0.08), black, rot=(-0.4, 0, 0), bevel=0.01))
front.append(K.box_obj("clamp_bottom", (0, HEAD[1] - 0.1, HEAD[2] + 0.03), (0.25, 0.04, 0.08), black, rot=(-0.4, 0, 0), bevel=0.01))
front.append(panel("fender", [(0.5, 0.5), (0.68, 0.56), (0.86, 0.48), (0.84, 0.45), (0.68, 0.53), (0.52, 0.47)], -0.065, 0.065, blue, bevel=0.008, levels=1))
# compact LED headlight (angular), flyscreen and dash
front.append(panel("headlight", [(0.52, 0.9), (0.6, 0.95), (0.64, 0.88), (0.62, 0.8), (0.53, 0.8)], -0.09, 0.09, black, bevel=0.015, levels=1))
front.append(panel("headlight_lens", [(0.6, 0.93), (0.645, 0.88), (0.63, 0.82), (0.6, 0.83)], -0.07, 0.07, lens, bevel=0.006, levels=1))
front.append(panel("flyscreen", [(0.5, 0.97), (0.58, 0.97), (0.6, 0.94), (0.52, 0.93)], -0.08, 0.08, black, bevel=0.006, levels=1))
front.append(K.box_obj("dash", (0, 1.0, 0.44), (0.12, 0.07, 0.03), black, rot=(-0.7, 0, 0), bevel=0.01))
# tapered handlebar, grips, levers, mirrors
front.append(K.curve_tube("bar", [(-0.36, 1.02, 0.36), (-0.12, 1.0, 0.42), (0.12, 1.0, 0.42), (0.36, 1.02, 0.36)], 0.012, black))
for s in (-1, 1):
    front.append(K.cyl_obj("grip", (s * 0.29, 1.012, 0.38), (s * 0.38, 1.022, 0.355), 0.017, rubber))
    front.append(K.curve_tube("lever", [(s * 0.23, 1.02, 0.41), (s * 0.34, 1.01, 0.44)], 0.006, alu))
    front.append(K.curve_tube("mirror_stalk", [(s * 0.21, 1.02, 0.4), (s * 0.25, 1.15, 0.37)], 0.007, black))
    front.append(panel("mirror", [(0.33, 1.15), (0.4, 1.16), (0.41, 1.19), (0.34, 1.2)], s * 0.22, s * 0.31, black, bevel=0.005, levels=1))

# ======================= assemble ===========================================


def apply_all(objs):
    for o in objs:
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


apply_all(front)
axis = (Vector(K.B(*FA)) - Vector(K.B(*HEAD))).normalized()
pivot = Vector(K.B(*HEAD))
turn = Matrix.Translation(pivot) @ Matrix.Rotation(-0.45, 4, axis) @ Matrix.Translation(-pivot)
for o in front:
    o.data.transform(turn)
decals = [o for o in bpy.context.scene.objects if o.name.startswith("decal_")]
everything = body + front + decals
apply_all(everything)
lean = K.to_blender(Matrix.Rotation(-0.16, 4, "Z"))
for o in everything:
    o.data.transform(lean)
by_mat = {}
for o in body + front:
    by_mat.setdefault(o.data.materials[0].name, []).append(o)
final = [K.join(g, k) for k, g in by_mat.items()]
for o in final:
    print("tris", o.name, K.tris(o))
K.bake_ao(final, distance=0.25, samples=24, strength=0.7)
K.export_glb(OUT)
