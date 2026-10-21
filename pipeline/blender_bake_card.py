"""Runs INSIDE Blender: bakes a foliage "card" texture (color + alpha) from a
real high-poly plant model, the way game studios make tree branch cards.

    blender -b --factory-startup -P pipeline/blender_bake_card.py -- <job.json>

job.json:
  {"input": ".../fir_sapling.gltf", "object": "fir_sapling_a",
   "output": ".../needles.png", "size": [1024, 512],
   "view": "top-wedge", "rotate": 0}

top-wedge: looks straight down at the plant and frames the strip from its
center outward along +X (one side of the crown), so the card's left edge is
where the branch meets the trunk.

Every material is replaced by an emission of its base color, so the render
is pure albedo (no baked lighting): the game lights the card itself.
"""
import json
import math
import sys

import bpy
from mathutils import Vector


def job():
    args = sys.argv[sys.argv.index("--") + 1:]
    with open(args[0], encoding="utf-8") as f:
        return json.load(f)


J = job()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=J["input"])
scene = bpy.context.scene

target = None
for o in list(scene.objects):
    if o.type == "MESH" and o.name == J["object"]:
        target = o
    elif o.type in {"MESH", "LIGHT", "CAMERA", "EMPTY"} and o.name != J["object"]:
        if not (o.type == "EMPTY" and any(c.name == J["object"] for c in o.children_recursive)):
            bpy.data.objects.remove(o, do_unlink=True)
assert target, "object not found"
target.rotation_mode = "XYZ"
target.rotation_euler.z += math.radians(J.get("rotate", 0))
bpy.context.view_layer.update()

# --- albedo-only materials -------------------------------------------------
for slot in target.material_slots:
    m = slot.material
    if not m or not m.use_nodes:
        continue
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
    if not bsdf or not out:
        continue
    em = nt.nodes.new("ShaderNodeEmission")
    base = bsdf.inputs["Base Color"]
    if base.is_linked:
        nt.links.new(base.links[0].from_socket, em.inputs["Color"])
    else:
        em.inputs["Color"].default_value = base.default_value
    alpha = bsdf.inputs["Alpha"]
    if alpha.is_linked:
        # keep cut-out leaves transparent
        mix = nt.nodes.new("ShaderNodeMixShader")
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        nt.links.new(alpha.links[0].from_socket, mix.inputs["Fac"])
        nt.links.new(tr.outputs[0], mix.inputs[1])
        nt.links.new(em.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])
    else:
        nt.links.new(em.outputs[0], out.inputs["Surface"])

# --- framing ---------------------------------------------------------------
pts = [target.matrix_world @ Vector(c) for c in target.bound_box]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
center = (lo + hi) / 2
w, h = J["size"]
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
if J.get("view", "top-wedge") == "top-wedge":
    radius = max(hi.x - center.x, hi.y - center.y) * 1.02
    cam_data.ortho_scale = radius  # width of the frame (w > h)
    cam.location = (center.x + radius / 2, center.y, hi.z + 5)
    cam.rotation_euler = (0, 0, 0)  # looking down -Z, image right = +X
cam_data.clip_end = 100
scene.camera = cam

scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 24
scene.cycles.use_denoising = False
scene.render.film_transparent = True
scene.render.resolution_x = w
scene.render.resolution_y = h
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "Standard"  # keep albedo colors as-is
scene.render.filepath = J["output"]
if scene.world is None:
    scene.world = bpy.data.worlds.new("w")
scene.world.use_nodes = True
bg = scene.world.node_tree.nodes.get("Background")
if bg:
    bg.inputs["Strength"].default_value = 0.0
bpy.ops.render.render(write_still=True)
print("BAKED", J["output"])
