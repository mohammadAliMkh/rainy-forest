"""Runs INSIDE Blender: skinned deer (doe & buck), rabbit and Luna (black
long-haired German Shepherd) for the game. One continuous body per animal,
grown with the Skin modifier around the joints of the game's own rigs
(Deer.js, Wildlife.js, Dog.js), an armature with one bone per joint,
automatic weights, rigid ears / eyes / nose / antlers / harness, and coat
colors in vertex colors.

    blender -b --factory-startup -P pipeline/blender_animals.py -- <out_dir>
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit as K  # noqa: E402
import bcreature as C  # noqa: E402

OUT = sys.argv[sys.argv.index("--") + 1]
os.makedirs(OUT, exist_ok=True)


def mats():
    K._mats.clear()
    return {
        "fur": K.flat("fur", (1, 1, 1), roughness=0.85),
        "dark": K.flat("dark", (0.02, 0.018, 0.016), roughness=0.3),
        "antler": K.flat("antler", (0.42, 0.36, 0.28), roughness=0.7),
        "strap": K.flat("strap", (0.35, 0.3, 0.2), roughness=0.85),
        "metal": K.flat("metal", (0.6, 0.6, 0.6), roughness=0.35, metallic=1.0),
        "tongue": K.flat("tongue", (0.65, 0.28, 0.32), roughness=0.4),
    }


def rigid_ellipsoid(name, rig, joint, local, radii, mat, extra=Matrix.Identity(4)):
    ob = C.ellipsoid(name, (0, 0, 0), radii, mat)
    C.transform_obj(ob, rig.j[joint]["world"] @ Matrix.Translation(Vector(local)) @ extra)
    return ob


# =========================================================== DEER ==========
def deer(buck):
    K.reset()
    M = mats()
    r = C.Rig()
    r.add("body", None, (0, 0, 0))
    r.add("neck", "body", (0, 1.13, 0.4), (0.42, 0, 0))
    r.add("head", "neck", (0, 0.56, 0), (-0.1, 0, 0))
    r.add("ear_0", "head", (-0.07, 0.12, -0.02), (-0.25, 0, 0.75))
    r.add("ear_1", "head", (0.07, 0.12, -0.02), (-0.25, 0, -0.75))
    legs = [(-0.13, 0.36, True), (0.13, 0.36, True), (-0.13, -0.38, False), (0.13, -0.38, False)]
    for i, (x, z, front) in enumerate(legs):
        r.add(f"hip_{i}", "body", (x, 0.96 if front else 1.0, z))
        r.add(f"knee_{i}", f"hip_{i}", (0, -(0.48 if front else 0.5), 0))
    r.add("tail", "body", (0, 1.13, -0.6), (0.35, 0, 0))

    Rn, Rh = r.j["neck"]["world"].to_3x3(), r.j["head"]["world"].to_3x3()
    ells = [((0, 1.0, -0.05), (0.18, 0.22, 0.46), None), ((0, 0.98, 0.24), (0.16, 0.24, 0.2), None),
            ((0, 1.04, -0.42), (0.16, 0.2, 0.2), None), ((0, 1.08, 0.36), (0.11, 0.15, 0.13), None),
            ((0, 1.02, -0.6), (0.11, 0.13, 0.08), None), ((0, 1.16, 0.45), (0.11, 0.16, 0.13), Rn), (r.p("neck", (0, 0.22, 0.01)), (0.085, 0.12, 0.1), Rn),
            (r.p("head", (0, 0.03, 0.06)), (0.08, 0.088, 0.13), Rh), (r.p("head", (0, -0.006, 0.23)), (0.05, 0.056, 0.115), Rh)]
    caps = [(r.p("neck", (0, 0.08, 0)), r.p("neck", (0, 0.48, 0)), 0.078)]
    for i, (x, z, front) in enumerate(legs):
        hip, mid, knee, low = r.p(f"hip_{i}"), r.p(f"hip_{i}", (0, -0.22, 0)), r.p(f"knee_{i}"), r.p(f"knee_{i}", (0, -0.42, 0))
        caps += [(hip, mid, 0.06 if front else 0.085), (mid, knee, 0.036 if front else 0.044), (knee, low, 0.023)]
    body = C.meta_body("deer", ells, caps, resolution=0.012, material=M["fur"], target_tris=7000)

    rigid = []
    for i, s in ((0, -1), (1, 1)):
        ob = rigid_ellipsoid(f"ear{i}", r, f"ear_{i}", (0, 0.06, 0), (0.06, 0.115, 0.02), M["fur"])
        rigid.append((ob, f"ear_{i}"))
    for s in (-1, 1):
        rigid.append((rigid_ellipsoid("eye", r, "head", (s * 0.068, 0.045, 0.11), (0.017, 0.017, 0.017), M["dark"]), "head"))
    rigid.append((rigid_ellipsoid("nose", r, "head", (0, -0.006, 0.338), (0.03, 0.026, 0.02), M["dark"]), "head"))
    rigid.append((rigid_ellipsoid("tailmesh", r, "tail", (0, -0.08, -0.01), (0.05, 0.11, 0.03), M["fur"]), "tail"))
    for i in range(4):
        hoof = K.cyl_obj("hoof", (0, 0, 0), (0, 0.06, 0), 0.032, M["dark"], seg=10, r1=0.024)
        C.transform_obj(hoof, r.j[f"knee_{i}"]["world"] @ Matrix.Translation(Vector((0, -0.48, 0))))
        rigid.append((hoof, f"knee_{i}"))
    if buck:
        for s in (-1, 1):
            base = r.p("head", (s * 0.05, 0.14, 0.02))
            beam = [base, r.p("head", (s * 0.16, 0.3, -0.06)), r.p("head", (s * 0.22, 0.42, 0.02)), r.p("head", (s * 0.2, 0.5, 0.14))]
            rigid.append((K.curve_tube("antler", [tuple(p) for p in beam], 0.016, M["antler"], resolution=4, bevel_res=2), "head"))
            for a, b in (((s * 0.15, 0.28, -0.05), (s * 0.12, 0.42, -0.02)), ((s * 0.21, 0.4, 0.0), (s * 0.18, 0.52, -0.04)),
                         ((s * 0.1, 0.2, 0.0), (s * 0.06, 0.26, 0.1))):
                rigid.append((K.curve_tube("tine", [tuple(r.p("head", a)), tuple(r.p("head", b))], 0.009, M["antler"], resolution=2, bevel_res=1), "head"))

    heads = {"body": (0, 1.0, -0.55)}
    tails = {"body": (0, 1.03, 0.42), "neck": tuple(r.p("head")), "head": tuple(r.p("head", (0, -0.01, 0.34))),
             "ear_0": tuple(r.p("ear_0", (0, 0.2, 0))), "ear_1": tuple(r.p("ear_1", (0, 0.2, 0))),
             "tail": tuple(r.p("tail", (0, -0.18, -0.02)))}
    for i in range(4):
        tails[f"hip_{i}"] = tuple(r.p(f"knee_{i}"))
        tails[f"knee_{i}"] = tuple(r.p(f"knee_{i}", (0, -0.45, 0)))
    arm = C.armature(r, tails, heads=heads, name="deer_rig")
    mesh = C.bind(body, arm, rigid)

    BROWN, CREAM, DARK, WHITE = [0.36, 0.2, 0.1], [0.75, 0.66, 0.55], [0.2, 0.12, 0.07], [0.9, 0.88, 0.84]

    def coat(p, n, mat):
        if mat != "fur":
            return (1, 1, 1)
        c = BROWN
        under = C.smoothstep(-0.1, -0.7, n.z if False else n.y)
        if p.y > 0.6 and p.y < 1.25 and abs(p.x) < 0.25:
            c = C.mix(c, CREAM, under * 0.85)
        if p.y < 0.55:
            c = C.mix(c, DARK, 0.25)
            if (n.x * (1 if p.x > 0 else -1)) < -0.2:
                c = C.mix(c, CREAM, 0.4)
        if p.z < -0.5 and p.y > 0.75 and n.z < 0.1:
            c = C.mix(c, WHITE, C.smoothstep(-0.5, -0.65, p.z) * 0.9)
        # throat and chin lighter, ears lighter inside
        hp = r.p("head")
        if (p - hp).length < 0.45 and n.y < -0.2:
            c = C.mix(c, CREAM, 0.6)
        return c

    C.paint(mesh, coat)
    for ob in (mesh, arm):
        print("tris", ob.name, K.tris(ob) if ob.type == "MESH" else "")
    C.export(os.path.join(OUT, "deer_buck.glb" if buck else "deer_doe.glb"), [mesh, arm])


# =========================================================== RABBIT ========
def rabbit():
    K.reset()
    M = mats()
    r = C.Rig()
    r.add("body", None, (0, 0, 0))
    r.add("head", "body", (0, 0.19, 0.12))
    Rh = r.j["head"]["world"].to_3x3()
    ells = [((0, 0.1, -0.07), (0.098, 0.095, 0.1), None), ((0, 0.12, 0.03), (0.085, 0.085, 0.09), None),
            ((0, 0.15, 0.1), (0.058, 0.06, 0.05), None), (r.p("head", (0, 0.0, 0.01)), (0.05, 0.05, 0.06), Rh),
            (r.p("head", (0, -0.01, 0.06)), (0.035, 0.034, 0.035), Rh),
            # big hind feet and small front paws grow out of the same body
            ((-0.055, 0.03, -0.07), (0.03, 0.03, 0.08), None), ((0.055, 0.03, -0.07), (0.03, 0.03, 0.08), None),
            ((-0.032, 0.035, 0.09), (0.02, 0.03, 0.028), None), ((0.032, 0.035, 0.09), (0.02, 0.03, 0.028), None)]
    body = C.meta_body("rabbit", ells, [], resolution=0.006, material=M["fur"], target_tris=3000)
    rigid = []
    for s in (-1, 1):
        ear = rigid_ellipsoid("ear", r, "head", (s * 0.025, 0.035, -0.01), (0.018, 0.075, 0.009), M["fur"],
                              extra=C.rot((-0.35, 0, -s * 0.15)) @ Matrix.Translation(Vector((0, 0.07, 0))))
        rigid.append((ear, "head"))
        rigid.append((rigid_ellipsoid("eye", r, "head", (s * 0.038, 0.012, 0.03), (0.011, 0.011, 0.011), M["dark"]), "head"))

    rigid.append((rigid_ellipsoid("puff", r, "body", (0, 0.13, -0.17), (0.03, 0.03, 0.028), M["fur"]), "body"))
    rigid.append((rigid_ellipsoid("nose", r, "head", (0, -0.01, 0.098), (0.008, 0.006, 0.005), M["dark"]), "head"))
    arm = C.armature(r, {"body": (0, 0.13, 0.1), "head": tuple(r.p("head", (0, 0, 0.08)))}, heads={"body": (0, 0.11, -0.13)}, name="rabbit_rig")
    mesh = C.bind(body, arm, rigid)
    FUR, LIGHT, WHITE, PINK = [0.16, 0.12, 0.085], [0.42, 0.37, 0.31], [0.85, 0.83, 0.8], [0.6, 0.42, 0.4]

    def coat(p, n, mat):
        if mat != "fur":
            return (1, 1, 1)
        c = C.mix(FUR, LIGHT, C.smoothstep(-0.1, -0.7, n.y) * 0.8)
        if p.z < -0.14 and p.y > 0.1:
            c = WHITE
        if p.y > 0.25:  # ears: lighter inside
            c = C.mix(c, PINK, 0.35 if n.z > 0.3 else 0.0)
        return c

    C.paint(mesh, coat)
    print("tris rabbit", K.tris(mesh))
    C.export(os.path.join(OUT, "rabbit.glb"), [mesh, arm])


# =========================================================== LUNA ==========
def luna():
    K.reset()
    M = mats()
    r = C.Rig()
    r.add("body", None, (0, 0.43, 0))
    legs = [(-0.075, -0.07, 0.25, 0.17, 0.16, True), (0.075, -0.07, 0.25, 0.17, 0.16, True),
            (-0.085, -0.04, -0.27, 0.2, 0.21, False), (0.085, -0.04, -0.27, 0.2, 0.21, False)]
    for i, (x, y, z, up, low, front) in enumerate(legs):
        hx, kx = (0.04, -0.04) if front else (-0.32, 0.6)
        r.add(f"hip_{i}", "body", (x, y, z), (hx, 0, 0))
        r.add(f"knee_{i}", f"hip_{i}", (0, -up, 0), (kx, 0, 0))
        r.add(f"paw_{i}", f"knee_{i}", (0, -low - 0.01, 0), (-(hx + kx) * (1 if front else 0.6), 0, 0))
    r.add("neck", "body", (0, 0.15, 0.34), (0.35, 0, 0), "YXZ")
    r.add("head", "neck", (0, 0.15, 0.08), (-0.3, 0, 0), "YXZ")
    r.add("jaw", "head", (0, -0.045, 0.05))
    r.add("ear_0", "head", (-0.045, 0.055, -0.01), (-0.15, 0, 0.28))
    r.add("ear_1", "head", (0.045, 0.055, -0.01), (-0.15, 0, -0.28))
    r.add("tail", "body", (0, 0.03, -0.42), (0.35, 0, 0))
    b = lambda local: r.p("body", local)  # noqa: E731
    Rb, Rn, Rh = r.j["body"]["world"].to_3x3(), r.j["neck"]["world"].to_3x3(), r.j["head"]["world"].to_3x3()
    ells = [(b((0, 0.0, -0.06)), (0.125, 0.14, 0.3), Rb), (b((0, 0.01, 0.2)), (0.14, 0.17, 0.16), Rb),
            (b((0, 0.01, -0.28)), (0.12, 0.14, 0.13), Rb), (b((0, 0.08, 0.3)), (0.13, 0.16, 0.13), Rb),  # ruff
            (r.p("neck", (0, 0.06, 0.02)), (0.09, 0.11, 0.09), Rn),
            (r.p("head", (0, 0.0, 0.02)), (0.07, 0.068, 0.085), Rh), (r.p("head", (0, -0.025, 0.11)), (0.038, 0.034, 0.06), Rh)]
    caps = []
    for i, (x, y, z, up, low, front) in enumerate(legs):
        caps += [(r.p(f"hip_{i}"), r.p(f"knee_{i}"), 0.04 if front else 0.055),
                 (r.p(f"knee_{i}"), r.p(f"paw_{i}"), 0.027 if front else 0.03)]
        if not front:
            ells.append((r.p(f"hip_{i}", (0, -0.06, 0.0)), (0.06, 0.09, 0.075), r.j[f"hip_{i}"]["world"].to_3x3()))
    tail_pts = [(0, 0, 0), (0, -0.05, -0.1), (0.01, -0.14, -0.19), (0.03, -0.25, -0.24), (0.05, -0.34, -0.24)]
    for k in range(len(tail_pts) - 1):
        caps.append((r.p("tail", tail_pts[k]), r.p("tail", tail_pts[k + 1]), 0.05 - k * 0.006))
    body = C.meta_body("luna", ells, caps, resolution=0.009, material=M["fur"], target_tris=6500)
    C.fur_noise(body, 0.013, seed=2.0, freq=24)  # long-haired, shaggy coat
    C.fur_noise(body, 0.016, seed=2.0, freq=26)

    rigid = []
    for i, s in ((0, -1), (1, 1)):
        ear = K.cyl_obj("ear", (0, 0, 0), (0, 0.11, 0), 0.038, M["fur"], seg=10, r1=0.004)
        ear.data.transform(Matrix.Diagonal((1, 0.55, 1, 1)))  # flatten front-back (Blender y = -game z)
        C.transform_obj(ear, r.j[f"ear_{i}"]["world"])
        rigid.append((ear, f"ear_{i}"))
        rigid.append((rigid_ellipsoid("eye", r, "head", (s * 0.037, 0.018, 0.075), (0.011, 0.011, 0.011), M["dark"]), "head"))
    rigid.append((rigid_ellipsoid("nose", r, "head", (0, -0.012, 0.165), (0.022, 0.016, 0.016), M["dark"]), "head"))
    jaw = K.cyl_obj("jaw", (0, 0, 0.0), (0, 0, 0.1), 0.03, M["fur"], seg=10, r1=0.02)
    jaw.data.transform(Matrix.Diagonal((1, 1, 0.55, 1)))
    C.transform_obj(jaw, r.j["jaw"]["world"])
    rigid.append((jaw, "jaw"))
    rigid.append((rigid_ellipsoid("tongue", r, "jaw", (0, 0.008, 0.07), (0.022, 0.006, 0.05), M["tongue"]), "jaw"))
    for i in range(4):
        rigid.append((rigid_ellipsoid("paw", r, f"paw_{i}", (0, -0.005, 0.02), (0.038, 0.024, 0.055), M["fur"]), f"paw_{i}"))
    # khaki harness: girth band, chest strap and the ring on her back
    band = [tuple(r.p("body", (0.138 * math.cos(a), 0.012 + 0.158 * math.sin(a), 0.14))) for a in [2 * math.pi * k / 24 for k in range(24)]]
    rigid.append((K.curve_tube("band", band, 0.013, M["strap"], resolution=2, bevel_res=1, closed=True), "body"))
    collar = [tuple(r.p("neck", (0.1 * math.cos(a), 0.02, 0.012 + 0.11 * math.sin(a)))) for a in [2 * math.pi * k / 20 for k in range(20)]]
    rigid.append((K.curve_tube("collar", collar, 0.012, M["strap"], resolution=2, bevel_res=1, closed=True), "neck"))
    ring = [tuple(r.p("body", (0.018 * math.cos(a), 0.18 + 0.018 * math.sin(a), 0.16))) for a in [2 * math.pi * k / 10 for k in range(10)]]
    rigid.append((K.curve_tube("ring", ring, 0.004, M["metal"], resolution=2, bevel_res=1, closed=True), "body"))

    heads = {"body": tuple(r.p("body", (0, 0.02, -0.38)))}
    tails = {"body": tuple(r.p("body", (0, 0.03, 0.3))), "neck": tuple(r.p("head")), "head": tuple(r.p("head", (0, -0.02, 0.16))),
             "jaw": tuple(r.p("jaw", (0, 0, 0.1))), "ear_0": tuple(r.p("ear_0", (0, 0.1, 0))), "ear_1": tuple(r.p("ear_1", (0, 0.1, 0))),
             "tail": tuple(r.p("tail", (0.05, -0.34, -0.24)))}
    for i in range(4):
        tails[f"hip_{i}"] = tuple(r.p(f"knee_{i}"))
        tails[f"knee_{i}"] = tuple(r.p(f"paw_{i}"))
        tails[f"paw_{i}"] = tuple(r.p(f"paw_{i}", (0, 0, 0.06)))
    arm = C.armature(r, tails, heads=heads, name="luna_rig")
    mesh = C.bind(body, arm, rigid)
    BLACK, TAN = [0.07, 0.06, 0.055], [0.24, 0.16, 0.11]

    def coat(p, n, mat):
        if mat != "fur":
            return (1, 1, 1)
        c = BLACK
        if p.y < 0.36:
            c = C.mix(c, TAN, C.smoothstep(0.36, 0.05, p.y) * 0.35)
        c = C.mix(c, TAN, C.smoothstep(-0.2, -0.8, n.y) * 0.25)
        return c

    C.paint(mesh, coat)
    print("tris luna", K.tris(mesh))
    C.export(os.path.join(OUT, "luna.glb"), [mesh, arm])


which = sys.argv[sys.argv.index("--") + 2:] or ["doe", "buck", "rabbit", "luna"]
for w in which:
    {"doe": lambda: deer(False), "buck": lambda: deer(True), "rabbit": rabbit, "luna": luna}[w]()
