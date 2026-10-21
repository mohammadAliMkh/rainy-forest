"""Runs INSIDE Blender: grows the four conifer types of the forest
(same heights / trunk sizes as src/game/world/Forest.js) with a realistic
spruce / fir structure and exports them as one .glb.

    blender -b --factory-startup -P pipeline/blender_trees.py -- <out.glb>

Each tree: a tapered, slightly leaning trunk with a root flare and moss on
its north side (vertex colors), dead stub branches on the bare lower part,
whorls of branches every ~0.55 m that rise from the trunk and then droop,
real branch wood near the trunk, and needle cards (the baked fir texture)
laid along every branch plus side sprays. Foliage normals point out from
the crown and vertex colors darken the inside of the crown, so the game's
existing materials light it softly. A light version is made for distance.

Mesh names: conifer_<i>_trunk, conifer_<i>_leaves, and the same + "_lo".
UVs match the game's materials: bark u = around / 1.2 m, v = height / 2.4 m;
cards u = along the branch (0 = trunk), v = across.
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit as K  # noqa: E402

OUT = sys.argv[sys.argv.index("--") + 1]
K.reset()

DEFS = [
    dict(height=27, r0=0.5, crown=0.42, radius=3.6, seed=3),
    dict(height=22, r0=0.38, crown=0.36, radius=2.9, seed=5),
    dict(height=32, r0=0.6, crown=0.55, radius=3.9, seed=9),
    dict(height=17, r0=0.3, crown=0.22, radius=2.6, seed=12),
]
mat_bark = K.flat("bark", (1, 1, 1), roughness=0.85)
mat_card = K.flat("needles", (1, 1, 1), roughness=0.6)


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


class Tree:
    def __init__(self, d, lo):
        self.d, self.lo = d, lo
        self.rnd = random.Random(d["seed"] * 31 + (7 if lo else 0))
        self.H = d["height"]
        lean = self.rnd.random() * 2 * math.pi
        self.bend = Vector((math.cos(lean), 0, math.sin(lean))) * self.H * 0.012

    def axis(self, y):
        t = y / self.H
        return Vector((self.bend.x * t * t, y, self.bend.z * t * t))

    def radius(self, y):
        t = y / self.H
        r = self.d["r0"] + (0.06 - self.d["r0"]) * t ** 0.85
        return r * (1 + 0.55 * math.exp(-y * 1.8))

    # ---------------------------------------------------------------- trunk
    def trunk(self, bm, uvl, col):
        radial = 6 if self.lo else 10
        rings = 5 if self.lo else 16
        moss_dir = self.rnd.random() * 2 * math.pi
        circ = max(1, round(self.d["r0"] * 2 * math.pi / 1.2))
        grid = []
        for j in range(rings + 1):
            y = self.H * (j / rings) ** 1.15
            c = self.axis(y)
            row = []
            for i in range(radial + 1):
                a = 2 * math.pi * i / radial
                k = 1 + 0.06 * math.sin(a * 3 + y * 0.7 + self.d["seed"]) * (1 if not self.lo else 0)
                r = self.radius(y) * k
                v = bm.verts.new(K.B(c.x + math.cos(a) * r, y, c.z + math.sin(a) * r))
                side = 0.5 + 0.5 * math.cos(a - moss_dir)
                mh = 3.0 * (0.6 + 0.6 * side)
                moss = (1 - smoothstep(mh * 0.4, mh, y)) * (0.35 + 0.65 * side)
                ao = 0.55 + 0.45 * smoothstep(0, 1.5, y)
                rgb = ((1 - moss + moss * 0.55) * ao, (1 - moss + moss * 0.9) * ao, (1 - moss + moss * 0.35) * ao)
                row.append((v, (i / radial * circ, y / 2.4), rgb))
            grid.append(row)
        for j in range(rings):
            for i in range(radial):
                q = (grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i])
                f = bm.faces.new([p[0] for p in q])
                f.smooth = True
                for loop, p in zip(f.loops, q):
                    loop[uvl].uv = p[1]
                    loop[col] = (*p[2], 1)

    def limb(self, bm, uvl, col, a, b, ra, rb, sides=4):
        """thin branch wood (4-6 sided tube), bark-mapped"""
        axis = b - a
        ln = axis.length
        if ln < 0.05:
            return
        rot = Vector((0, 1, 0)).rotation_difference(axis.normalized())
        rings = []
        for t, r in ((0.0, ra), (1.0, rb)):
            row = []
            for i in range(sides + 1):
                ang = 2 * math.pi * i / sides
                p = a + axis * t + rot @ Vector((math.cos(ang) * r, 0, math.sin(ang) * r))
                row.append((bm.verts.new(K.B(*p)), (i / sides * 0.4, (a.y + axis.y * t) / 2.4 + t * ln / 2.4)))
            rings.append(row)
        for i in range(sides):
            q = (rings[0][i], rings[0][i + 1], rings[1][i + 1], rings[1][i])
            f = bm.faces.new([p[0] for p in q])
            f.smooth = True
            for loop, p in zip(f.loops, q):
                loop[uvl].uv = p[1]
                loop[col] = (0.62, 0.6, 0.58, 1)

    # --------------------------------------------------------------- crown
    def card(self, bm, uvl, col, base, direction, length, width, roll, droop, normals):
        """a needle card from `base` along `direction` (2 segments, the outer one drooping)"""
        d = direction.normalized()
        side = Vector((0, 1, 0)).cross(d)
        if side.length < 1e-4:
            side = Vector((1, 0, 0))
        side.normalize()
        up = d.cross(side).normalized()
        # roll the card about its own axis
        side = (side * math.cos(roll) + up * math.sin(roll)).normalized()
        segs = 1 if self.lo else 2
        rows = []
        for s in range(segs + 1):
            t = s / segs
            p = base + d * length * t - Vector((0, 1, 0)) * droop * length * t * t
            rows.append([(p - side * width / 2, (t, 0.0)), (p + side * width / 2, (t, 1.0))])
        for s in range(segs):
            q = (rows[s][0], rows[s + 1][0], rows[s + 1][1], rows[s][1])
            verts = [bm.verts.new(K.B(*p[0])) for p in q]
            f = bm.faces.new(verts)
            f.smooth = True
            for loop, p, v in zip(f.loops, q, verts):
                loop[uvl].uv = p[1]
                normals[v] = p[0]

    def crown(self, bm_l, uvl_l, col_l, bm_t, uvl_t, col_t, normals):
        d, H = self.d, self.H
        y0 = H * d["crown"]
        step = 1.1 if self.lo else 0.55
        per = 4 if self.lo else 5
        y = y0
        k = 0
        while y < H - 0.6:
            t = (y - y0) / (H - y0)
            L = d["radius"] * (1 - t) ** 0.9 * self.rnd.uniform(0.8, 1.15) + 0.45
            base_yaw = self.rnd.random() * 2 * math.pi
            for b in range(per):
                yaw = base_yaw + 2 * math.pi * b / per + self.rnd.uniform(-0.3, 0.3)
                out = Vector((math.cos(yaw), 0, math.sin(yaw)))
                rise = self.rnd.uniform(0.05, 0.25) - (1 - t) * 0.15
                droop = 0.25 + (1 - t) * 0.25 + self.rnd.uniform(0, 0.1)
                start = self.axis(y)
                dir0 = (out + Vector((0, rise, 0))).normalized()
                # branch wood near the trunk (hidden in the needles further out)
                if not self.lo and t < 0.85:
                    tip = start + dir0 * L * 0.55 - Vector((0, droop * L * 0.12, 0))
                    self.limb(bm_t, uvl_t, col_t, start, tip, 0.05 * (1 - t) + 0.015, 0.01)
                # main card along the branch, plus side sprays
                w = L * 0.55 * self.rnd.uniform(0.9, 1.15)
                self.card(bm_l, uvl_l, col_l, start, dir0, L, w, self.rnd.uniform(-0.35, 0.35), droop, normals)
                if not self.lo:
                    for sgn in (-1, 1):
                        if self.rnd.random() < 0.75:
                            s_base = start + dir0 * L * self.rnd.uniform(0.25, 0.45)
                            s_dir = (dir0 + Vector((-dir0.z, 0, dir0.x)) * sgn * 0.75).normalized()
                            self.card(bm_l, uvl_l, col_l, s_base, s_dir, L * 0.6, w * 0.7, self.rnd.uniform(-0.4, 0.4), droop * 0.8, normals)
            y += step * self.rnd.uniform(0.8, 1.2) * (0.85 + 0.3 * (1 - t))
            k += 1
        # spire
        top = self.axis(H - 0.2)
        for i in range(2):
            yaw = i * math.pi / 2
            self.card(bm_l, uvl_l, col_l, top + Vector((0, -1.0, 0)), Vector((0.02 * math.cos(yaw), 1, 0.02 * math.sin(yaw))), 1.6, 0.7, yaw, 0.0, normals)

    def stubs(self, bm, uvl, col):
        if self.lo:
            return
        for _ in range(9):
            y = self.H * (0.1 + self.rnd.random() * (self.d["crown"] - 0.1))
            a = self.axis(y)
            ang = self.rnd.random() * 2 * math.pi
            ln = 0.3 + self.rnd.random() * 1.1
            b = a + Vector((math.cos(ang) * ln, ln * 0.05 - self.rnd.random() * 0.2, math.sin(ang) * ln))
            self.limb(bm, uvl, col, a, b, 0.04, 0.01)

    def build(self, idx):
        suffix = "_lo" if self.lo else ""
        bm_t, bm_l = bmesh.new(), bmesh.new()
        uvl_t, uvl_l = bm_t.loops.layers.uv.verify(), bm_l.loops.layers.uv.verify()
        col_t = bm_t.loops.layers.float_color.new("Col")
        col_l = bm_l.loops.layers.float_color.new("Col")
        normals = {}
        self.trunk(bm_t, uvl_t, col_t)
        self.stubs(bm_t, uvl_t, col_t)
        self.crown(bm_l, uvl_l, col_l, bm_t, uvl_t, col_t, normals)
        # crown shading: normals out from the crown axis, darker inside / lower
        H, cs = self.H, self.d["crown"]
        cy = H * (cs + 0.5 * (1 - cs))
        R = self.d["radius"]
        vnorm = {}
        for v in bm_l.verts:
            p = normals.get(v)
            if p is None:
                continue
            ax = self.axis(p.y)
            rel = Vector((p.x - ax.x, (p.y - cy) * 0.35 + 0.45 * R, p.z - ax.z)).normalized()
            vnorm[v] = rel
            yt = smoothstep(H * cs, H, p.y)
            outer = min(1.0, math.hypot(p.x - ax.x, p.z - ax.z) / max(0.5, R * (1 - yt * 0.7)))
            ao = 0.38 + 0.42 * outer + 0.3 * yt
            for loop in v.link_loops:
                loop[col_l] = (ao * 0.97, ao, ao * 0.93, 1)
        trunk = K.new_obj(f"conifer_{idx}_trunk{suffix}", bm_t, mat_bark)
        me = bpy.data.meshes.new(f"conifer_{idx}_leaves{suffix}")
        bm_l.to_mesh(me)
        order = list(bm_l.verts)
        bm_l.free()
        leaves = bpy.data.objects.new(me.name, me)
        bpy.context.scene.collection.objects.link(leaves)
        me.materials.append(mat_card)
        # custom normals (Blender -> game frame handled by the exporter)
        custom = []
        for v in order:
            n = vnorm.get(v, Vector((0, 1, 0)))
            custom.append(K.B(n.x, n.y, n.z).normalized())
        for p in me.polygons:
            p.use_smooth = True
        me.normals_split_custom_set_from_vertices(custom)
        for ob in (trunk, leaves):
            ob.data.color_attributes.active_color = ob.data.color_attributes["Col"]
        print(f"tree {idx}{suffix}: trunk {K.tris(trunk)} leaves {K.tris(leaves)}")


for i, d in enumerate(DEFS):
    for lo in (False, True):
        Tree(d, lo).build(i)
K.export_glb(OUT, color_name="Col")
