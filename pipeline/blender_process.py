"""Runs INSIDE Blender (portable, from graphVenv):

    blender -b --factory-startup -P pipeline/blender_process.py -- <job.json>

job.json:
  {"mode": "inspect" | "process",
   "input": ".../model.gltf",
   "output": ".../model.glb",            # process only
   "objects": {"<name or *>": {"tris": 2000, "as": "rock_a"}},   # process only
   "join": false}

process: keeps the listed objects, applies transforms, decimates each to its
triangle budget, moves its origin to the bottom-center, renames it and
exports one .glb (Y-up, meters) with its textures.
"""
import json
import sys

import bpy
from mathutils import Matrix, Vector


def load_job():
    args = sys.argv[sys.argv.index("--") + 1:]
    with open(args[0], encoding="utf-8") as f:
        return json.load(f)


def tri_count(obj):
    me = obj.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def world_bounds(obj):
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_gltf(path):
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def select_only(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def inspect(job):
    reset()
    meshes = import_gltf(job["input"])
    for o in sorted(meshes, key=lambda o: o.name):
        lo, hi = world_bounds(o)
        size = hi - lo
        mats = ",".join(m.name for m in o.data.materials if m)
        print(f"OBJ {o.name:40s} tris={tri_count(o):8d} size=({size.x:.2f},{size.y:.2f},{size.z:.2f}) mats={mats}")


def process(job):
    reset()
    meshes = import_gltf(job["input"])
    spec = job["objects"]
    keep = []
    for o in meshes:
        cfg = spec.get(o.name) or spec.get("*")
        if cfg is None:
            continue
        keep.append((o, cfg))
    # drop everything else (lights, cameras, unused meshes)
    keep_set = {o for o, _ in keep}
    for o in list(bpy.context.scene.objects):
        if o not in keep_set:
            bpy.data.objects.remove(o, do_unlink=True)

    for o, cfg in keep:
        # detach from parents / empties, bake transforms into the mesh
        if o.parent:
            mw = o.matrix_world.copy()
            o.parent = None
            o.matrix_world = mw
        select_only([o])
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        before = tri_count(o)
        target = cfg.get("tris")
        if target and before > target:
            mod = o.modifiers.new("decimate", "DECIMATE")
            mod.decimate_type = "COLLAPSE"
            mod.ratio = max(0.002, target / before)
            mod.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=mod.name)
        # origin at bottom-center, object at world origin
        lo, hi = world_bounds(o)
        pivot = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
        o.data.transform(Matrix.Translation(-(pivot - o.matrix_world.translation)))
        o.location = (0, 0, 0)
        if cfg.get("as"):
            o.name = cfg["as"]
            o.data.name = cfg["as"]
        print(f"DONE {o.name:24s} tris {before} -> {tri_count(o)}")

    if job.get("join") and len(keep) > 1:
        select_only([o for o, _ in keep])
        bpy.ops.object.join()

    bpy.ops.export_scene.gltf(
        filepath=job["output"],
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        use_selection=False,
    )
    print("EXPORTED", job["output"])


job = load_job()
{"inspect": inspect, "process": process}[job["mode"]](job)
