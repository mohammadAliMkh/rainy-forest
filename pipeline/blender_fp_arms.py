"""Runs INSIDE Blender: the player's own forearms and hands, for the
first-person view, cut from the owner's model (person_owner.glb, built by
blender_people.py) so they have his real skin and hand shape:

    blender -b --factory-startup -P pipeline/blender_fp_arms.py -- public/assets/models/person_owner.glb public/assets/models/fp_arms.glb

Keeps the body (skin) and the clothes (the sleeves) only where they belong
to the forearms, wrists, palms and fingers of both arms; everything else is
deleted. The armature stays (the game moves the forearm, wrist and finger
bones); vertex groups of other bones are dropped.
"""
import sys
import bpy
import bmesh

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

ARM = next(o for o in bpy.data.objects if o.type == "ARMATURE")
KEEP_MESHES = ("body", "clothes_male_casualsuit05")
# the bones of the forearm and the hand, both sides
HAND = ["lowerarm01", "lowerarm02", "wrist"] + [f"metacarpal{i}" for i in range(1, 5)] + [f"finger{i}-{j}" for i in range(1, 6) for j in range(1, 4)]
KEEP_BONES = {f"{b}.{s}" for b in HAND for s in ("L", "R")}

for o in list(bpy.data.objects):
    if o.type == "MESH" and o.name not in KEEP_MESHES:
        bpy.data.objects.remove(o, do_unlink=True)

for name in KEEP_MESHES:
    ob = bpy.data.objects.get(name)
    if not ob:
        continue
    keep_idx = {g.index for g in ob.vertex_groups if g.name in KEEP_BONES}
    # mostly moved by the forearm / hand bones: keep (a little of the elbow side of the sleeve goes too)
    drop = set()
    for v in ob.data.vertices:
        w = sum(g.weight for g in v.groups if g.group in keep_idx)
        total = sum(g.weight for g in v.groups) or 1.0
        if w / total < 0.6:
            drop.add(v.index)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in drop], context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    for g in list(ob.vertex_groups):
        if g.name not in KEEP_BONES:
            ob.vertex_groups.remove(g)
    print(name, "kept", len(ob.data.vertices), "vertices")

bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB", export_skins=True, export_animations=False,
    export_morph=False, export_image_format="JPEG", export_jpeg_quality=85, use_selection=False,
)
print("written", OUT)
