"""Small modelling toolkit used by the Blender build scripts (cabin, shop,
vehicles, trees). Runs INSIDE Blender.

Coordinates: helpers take the GAME's local frame (x right, y up, z toward
the front) and convert to Blender's Z-up frame, so the exported glTF lands
exactly where the game code expects it.
"""
from __future__ import annotations

import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

KIT = os.environ.get("KIT_DIR", "")  # graphVenv/cache/kit (set by the runner)


# ---------------------------------------------------------------- frames ---
def B(x, y, z):
    """game (x, y-up, z-front) -> Blender (x, -z, y)"""
    return Vector((x, -z, y))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    random.seed(7)


# ------------------------------------------------------------- materials ---
_mats: dict[str, bpy.types.Material] = {}


def _img(path, non_color):
    img = bpy.data.images.load(path, check_existing=True)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img


def tinted_image(asset, rgb, name):
    """a copy of the asset's color map multiplied by rgb (baked, so the glTF stays simple)"""
    src = bpy.data.images.load(os.path.join(KIT, f"{asset}_diff.jpg"), check_existing=True)
    w, h = src.size
    px = list(src.pixels[:])
    for i in range(0, len(px), 4):
        px[i] *= rgb[0]
        px[i + 1] *= rgb[1]
        px[i + 2] *= rgb[2]
    img = bpy.data.images.new(name, w, h)
    img.pixels[:] = px
    img.filepath_raw = os.path.join(KIT, f"{name}.png")
    img.file_format = "PNG"
    img.save()
    return img


def pbr(name, asset, tint=None, roughness=None, normal_strength=1.0):
    """Principled material from a scanned texture set in the kit folder."""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    diff = tinted_image(asset, tint, f"{name}_tinted") if tint else _img(os.path.join(KIT, f"{asset}_diff.jpg"), False)
    tc = nt.nodes.new("ShaderNodeTexImage")
    tc.image = diff
    nt.links.new(tc.outputs["Color"], bsdf.inputs["Base Color"])
    nor_p = os.path.join(KIT, f"{asset}_nor.jpg")
    if os.path.exists(nor_p):
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = _img(nor_p, True)
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = normal_strength
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    arm_p = os.path.join(KIT, f"{asset}_arm.jpg")
    if os.path.exists(arm_p) and roughness is None:
        ta = nt.nodes.new("ShaderNodeTexImage")
        ta.image = _img(arm_p, True)
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(ta.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    else:
        bsdf.inputs["Roughness"].default_value = roughness if roughness is not None else 0.8
        bsdf.inputs["Metallic"].default_value = 0.0
    _mats[name] = m
    return m


def flat(name, color, roughness=0.6, metallic=0.0, emission=None, strength=1.0, alpha=None):
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    if alpha is not None:
        bsdf.inputs["Alpha"].default_value = alpha
        m.blend_method = "BLEND" if hasattr(m, "blend_method") else None
    _mats[name] = m
    return m


def tile_size(asset, default=2.0):
    p = os.path.join(KIT, f"{asset}.size")
    try:
        return float(open(p).read())
    except OSError:
        return default


# -------------------------------------------------------------- geometry ---
def new_obj(name, bm, material, parent=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if material:
        for m in material if isinstance(material, (list, tuple)) else [material]:
            me.materials.append(m)
    if parent:
        ob.parent = parent
    return ob


# game-frame matrix -> Blender-frame matrix
_C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def to_blender(mg):
    return _C @ mg @ _C.inverted()


def bm_obox(bm, center, dims, rot=(0.0, 0.0, 0.0)):
    """oriented box: center & dims in the game frame, rot = game Euler XYZ (radians)"""
    from mathutils import Euler
    mg = Matrix.Translation(Vector(center)) @ Euler(rot, "XYZ").to_matrix().to_4x4() @ Matrix.Diagonal((*dims, 1))
    return bmesh.ops.create_cube(bm, size=1.0, matrix=to_blender(mg))["verts"]


def bm_box(bm, c0, c1, tilt=None):
    """axis-aligned box between two game-frame corners"""
    lo = B(min(c0[0], c1[0]), min(c0[1], c1[1]), max(c0[2], c1[2]))
    hi = B(max(c0[0], c1[0]), max(c0[1], c1[1]), min(c0[2], c1[2]))
    size = hi - lo
    center = (lo + hi) / 2
    m = Matrix.Translation(center) @ Matrix.Diagonal((abs(size.x), abs(size.y), abs(size.z), 1))
    if tilt is not None:
        m = tilt @ m
    res = bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    return res["verts"]


def bm_tube(bm, a, b, r0, r1=None, seg=16, rings=1, caps=True, wobble=0.0, tile=(1.0, 1.0), seed=0.0, cap_index=1):
    """Tapered tube from game point a to game point b, with UVs in meters
    (u around / tile[0], v along / tile[1]). Side faces get material index 0,
    end caps `cap_index` with a 0..1 disc mapping (for end-grain textures)."""
    r1 = r0 if r1 is None else r1
    uvl = bm.loops.layers.uv.verify()
    A, Bp = B(*a), B(*b)
    axis = Bp - A
    L = axis.length
    rot = axis.to_track_quat("Z", "Y").to_matrix()
    grid = []
    for j in range(rings + 1):
        t = j / rings
        r = r0 + (r1 - r0) * t
        row = []
        for i in range(seg):
            ang = 2 * math.pi * i / seg
            k = 1 + wobble * math.sin(t * 7.1 + seed) * math.cos(ang * 3 + seed * 2.3) + wobble * 0.5 * math.sin(ang * 5 + t * 3 + seed)
            p = Vector((math.cos(ang) * r * k, math.sin(ang) * r * k, t * L))
            row.append(bm.verts.new(A + rot @ p))
        grid.append(row)
    circ = 2 * math.pi * (r0 + r1) / 2
    for j in range(rings):
        for i in range(seg):
            i2 = (i + 1) % seg
            f = bm.faces.new((grid[j][i], grid[j][i2], grid[j + 1][i2], grid[j + 1][i]))
            f.material_index = 0
            f.smooth = True
            for loop, (ii, jj) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                loop[uvl].uv = (ii / seg * circ / tile[0], jj / rings * L / tile[1])
    if caps:
        for j, flip in ((0, True), (rings, False)):
            ring = grid[j][::-1] if flip else grid[j]
            f = bm.faces.new(ring)
            f.material_index = cap_index
            f.smooth = False
            for loop, v in zip(f.loops, ring):
                i = grid[j].index(v)
                ang = 2 * math.pi * i / seg
                loop[uvl].uv = (0.5 + 0.48 * math.cos(ang), 0.5 + 0.48 * math.sin(ang))
    return grid


def world_uv(ob, tile):
    """box projection at real-world scale: every face maps its dominant plane"""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    mw = ob.matrix_world
    for p in me.polygons:
        n = p.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in p.loop_indices:
            co = mw @ me.vertices[me.loops[li].vertex_index].co
            if ax == 0:
                u, v = co.y, co.z
            elif ax == 1:
                u, v = co.x, co.z
            else:
                u, v = co.x, co.y
            uv[li].uv = (u / tile, v / tile)


def along_uv(ob, tile_u, tile_v, axis_game="x"):
    """cylindrical-ish mapping for logs/boards: grain along the given game axis"""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    ai = {"x": 0, "y": 2, "z": 1}[axis_game]
    for p in me.polygons:
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            others = [i for i in range(3) if i != ai]
            ang = math.atan2(co[others[1]], co[others[0]])
            uv[li].uv = (ang * 0.15 / tile_u * 2, co[ai] / tile_v)


# ------------------------------------------------------------------- bake ---
def bake_ao(objects, distance=1.2, samples=48, strength=0.85):
    """ambient occlusion baked into vertex colors (COLOR_0 in glTF)"""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    if scene.world is None:
        scene.world = bpy.data.worlds.new("w")
    scene.world.light_settings.distance = distance
    scene.render.bake.target = "VERTEX_COLORS"
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objects:
        me = ob.data
        if "AO" not in me.color_attributes:
            me.color_attributes.new(name="AO", type="BYTE_COLOR", domain="CORNER")
        me.color_attributes.active_color = me.color_attributes["AO"]
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.bake(type="AO")
    # soften: mix toward white so AO darkens corners without crushing texture
    for ob in objects:
        attr = ob.data.color_attributes["AO"]
        for d in attr.data:
            c = d.color
            v = 1 - (1 - c[0]) * strength
            d.color = (v, v, v, 1)


# ------------------------------------------------------------------ misc ---
def join(objs, name):
    objs = [o for o in objs if o is not None]
    if len(objs) == 1:
        objs[0].name = name
        return objs[0]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    return ob


def apply_mods(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def bevel(ob, width=0.01, segments=2):
    m = ob.modifiers.new("bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    apply_mods(ob)


def export_glb(path):
    kw = dict(filepath=path, export_format="GLB", export_yup=True, export_apply=True,
              export_texcoords=True, export_normals=True, export_materials="EXPORT", export_image_format="AUTO")
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    if "export_vertex_color" in props:
        kw["export_vertex_color"] = "ACTIVE"
    elif "export_colors" in props:
        kw["export_colors"] = True
    if "export_all_vertex_colors" in props:
        kw["export_all_vertex_colors"] = False
    bpy.ops.export_scene.gltf(**kw)
    print("EXPORTED", path)


def tris(ob):
    ob.data.calc_loop_triangles()
    return len(ob.data.loop_triangles)
