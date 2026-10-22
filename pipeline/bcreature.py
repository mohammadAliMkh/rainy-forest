"""Toolkit for skinned animals (runs INSIDE Blender, used by
blender_animals.py).

The game animates each animal with a hierarchy of joints (Deer.js, Dog.js,
Wildlife.js). Here the same joints are rebuilt with the same positions and
rotations (forward kinematics in the game's frame), a continuous body is
grown around them with the Skin modifier, an armature with one bone per
joint is added, weights are computed automatically, and rigid parts (ears,
eyes, nose, antlers, harness...) are bound 100% to their bone. The game
then copies its joint motion onto the bones every frame (skinBinding.ts).
"""
from __future__ import annotations

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

import bkit as K


# ------------------------------------------------------------ kinematics ---
def rot(e, order="XYZ"):
    """three.js Euler -> matrix (game frame)"""
    x, y, z = e
    R = {"X": Matrix.Rotation(x, 4, "X"), "Y": Matrix.Rotation(y, 4, "Y"), "Z": Matrix.Rotation(z, 4, "Z")}
    m = Matrix.Identity(4)
    for ax in order:
        m = m @ R[ax]
    return m


class Rig:
    """joints: name -> (parent, local position, euler, order); world matrices in the game frame"""

    def __init__(self):
        self.j = {}
        self.order = []

    def add(self, name, parent, pos, euler=(0, 0, 0), order="XYZ"):
        pm = self.j[parent]["world"] if parent else Matrix.Identity(4)
        world = pm @ Matrix.Translation(Vector(pos)) @ rot(euler, order)
        self.j[name] = {"parent": parent, "world": world}
        self.order.append(name)
        return world

    def p(self, name, local=(0, 0, 0)):
        """game-frame point given in a joint's local frame"""
        return (self.j[name]["world"] @ Vector((*local, 1))).to_3d()


# ----------------------------------------------------------- skin body ----
def skin_body(name, nodes, edges, root=0, subsurf=2, material=None):
    """nodes: [(game point, (rx, ry))], edges: [(i, j)] -> smooth organic mesh"""
    me = bpy.data.meshes.new(name)
    verts = [K.B(*p) for p, _ in nodes]
    me.from_pydata(verts, edges, [])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    sk = ob.modifiers.new("skin", "SKIN")
    sk.use_smooth_shade = True
    sk.branch_smoothing = 0.6
    for i, (_, r) in enumerate(nodes):
        d = me.skin_vertices[0].data[i]
        d.radius = r
        d.use_root = i == root
    sub = ob.modifiers.new("sub", "SUBSURF")
    sub.levels = subsurf
    sub.render_levels = subsurf
    K.apply_mods(ob)
    for pgon in ob.data.polygons:
        pgon.use_smooth = True
    if material:
        ob.data.materials.append(material)
    return ob


def ellipsoid(name, center, radii, material, seg=16, rings=10):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * radii[0], v.co.y * radii[2], v.co.z * radii[1]))  # game (x, y, z) radii -> Blender (x, z, y)
        v.co += K.B(*center)
    ob = K.new_obj(name, bm, material)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def transform_obj(ob, game_matrix):
    """apply a game-frame matrix to an object's mesh"""
    ob.data.transform(K.to_blender(game_matrix))


# -------------------------------------------------------------- armature --
def armature(rig, tails, heads=None, name="rig"):
    """one bone per joint; heads / tails: joint -> game point (the bone's placement only
    guides the automatic weights; the game drives each bone from its joint)"""
    heads = heads or {}
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = {}
    for n in rig.order:
        b = arm.edit_bones.new(n)
        head = Vector(heads[n]) if n in heads else rig.p(n)
        tail = Vector(tails[n]) if n in tails else head + (rig.j[n]["world"].to_3x3() @ Vector((0, 0.05, 0)))
        if (tail - head).length < 1e-3:
            tail = head + Vector((0, 0.05, 0))
        b.head = K.B(*head)
        b.tail = K.B(*tail)
        par = rig.j[n]["parent"]
        if par:
            b.parent = eb[par]
        eb[n] = b
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob


def bind(body, arm, rigid=()):
    """automatic weights for the body, rigid (100%) weights for extra parts"""
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    parts = []
    for ob, bone in rigid:
        vg = ob.vertex_groups.new(name=bone)
        vg.add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
        parts.append(ob)
    if parts:
        bpy.ops.object.select_all(action="DESELECT")
        for o in parts + [body]:
            o.select_set(True)
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def paint(ob, fn, name="Col"):
    """per-corner vertex colors from fn(game point, game normal, material name)"""
    me = ob.data
    if name not in me.color_attributes:
        me.color_attributes.new(name=name, type="FLOAT_COLOR", domain="CORNER")
    attr = me.color_attributes[name]
    inv = K._C.inverted()
    for poly in me.polygons:
        mat = me.materials[poly.material_index].name if me.materials else ""
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index]
            p = (inv @ v.co.to_4d()).to_3d()
            n = (inv.to_3x3() @ v.normal)
            c = fn(p, n, mat)
            attr.data[li].color = (c[0], c[1], c[2], 1.0)
    me.color_attributes.active_color = attr


def fur_noise(ob, amount, seed=1.0, freq=28.0):
    """shaggy coat: push vertices along their normals with 3D noise"""
    import mathutils.noise as N
    me = ob.data
    me.calc_normals_split() if hasattr(me, "calc_normals_split") else None
    for v in me.vertices:
        k = N.noise(v.co * freq + Vector((seed, seed * 1.7, seed * 0.3)))
        k2 = N.noise(v.co * freq * 2.6 + Vector((seed * 3, 0, 1)))
        v.co += v.normal * (k * 0.65 + k2 * 0.35) * amount


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    return [a[i] + (b[i] - a[i]) * t for i in range(3)]


def export(path, objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    kw = dict(filepath=path, export_format="GLB", export_yup=True, use_selection=True, export_skins=True,
              export_animations=False, export_materials="EXPORT", export_texcoords=True, export_normals=True)
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    if "export_vertex_color" in props:
        kw["export_vertex_color"] = "NAME"
        kw["export_vertex_color_name"] = "Col"
    bpy.ops.export_scene.gltf(**kw)
    print("EXPORTED", path)


# ---------------------------------------------------------- metaball body --
def _orient(direction):
    """rotation (Blender frame quaternion) that turns local +X onto a game direction"""
    d = K.B(*direction).normalized()
    return Vector((1, 0, 0)).rotation_difference(d)


def meta_body(name, ellipsoids=(), capsules=(), resolution=0.018, material=None, target_tris=6000, threshold=0.6):
    """organic body from blended metaballs.
    ellipsoids: [(game center, (rx, ry, rz) game radii, game 3x3 orientation or None)]
    capsules: [(game point a, game point b, radius)]"""
    mb = bpy.data.metaballs.new(name)
    mb.resolution = resolution
    mb.render_resolution = resolution
    mb.threshold = threshold
    ob = bpy.data.objects.new(name, mb)
    bpy.context.scene.collection.objects.link(ob)
    for c, rad, orient in ellipsoids:
        e = mb.elements.new(type="ELLIPSOID")
        e.co = K.B(*c)
        e.radius = 1.0
        e.stiffness = 2.0
        # game radii (x, y, z) -> Blender local (x, z, y) before orientation
        # a metaball's visible surface sits at ~0.67 of its radius: inflate
        e.size_x, e.size_y, e.size_z = rad[0] * 1.45, rad[2] * 1.45, rad[1] * 1.45
        if orient is not None:
            e.rotation = K.to_blender(orient.to_4x4()).to_quaternion()
    for a, b, r in capsules:
        e = mb.elements.new(type="CAPSULE")
        A, Bv = Vector(a), Vector(b)
        e.co = K.B(*((A + Bv) / 2))
        e.radius = r * 1.45
        e.stiffness = 2.0
        e.size_x = (Bv - A).length / 2
        e.rotation = _orient(Bv - A)
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target="MESH")
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    # even topology, then down to the triangle budget
    rm = ob.modifiers.new("remesh", "REMESH")
    rm.mode = "VOXEL"
    rm.voxel_size = resolution * 0.7
    K.apply_mods(ob)
    t = K.tris(ob)
    if t > target_tris:
        dm = ob.modifiers.new("dec", "DECIMATE")
        dm.ratio = target_tris / t
        K.apply_mods(ob)
    sm = ob.modifiers.new("smooth", "SMOOTH")
    sm.factor = 0.5
    sm.iterations = 3
    K.apply_mods(ob)
    for p in ob.data.polygons:
        p.use_smooth = True
    ob.data.materials.clear()
    if material:
        ob.data.materials.append(material)
    return ob
