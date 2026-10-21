"""Runs INSIDE Blender: quick preview render of an exported .glb so a model
can be checked before it goes into the game.

    blender -b --factory-startup -P pipeline/blender_preview.py -- <in.glb> <out.png> [yaw_deg] [dist] [height] [target_y]
"""
import math
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
src, out = args[0], args[1]
yaw = math.radians(float(args[2])) if len(args) > 2 else math.radians(35)
dist = float(args[3]) if len(args) > 3 else 12
height = float(args[4]) if len(args) > 4 else 2.5
ty = float(args[5]) if len(args) > 5 else 1.8

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene
# glTF game frame: front = +Z (game) = -Y (Blender)
target = Vector((0, 0, ty))
cam_pos = Vector((math.sin(yaw) * dist, -math.cos(yaw) * dist, height))
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
cam.location = cam_pos
cam.rotation_euler = (target - cam_pos).to_track_quat("-Z", "Y").to_euler()
cam.data.lens = 32
scene.camera = cam
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 2.5
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
scene.collection.objects.link(sun)
scene.world = bpy.data.worlds.new("w")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.6, 0.66, 1)
scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
# ground
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
g = bpy.context.active_object
gm = bpy.data.materials.new("g")
gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.12, 0.11, 0.08, 1)
g.data.materials.append(gm)
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.resolution_x = 960
scene.render.resolution_y = 600
scene.render.filepath = out
scene.view_settings.view_transform = "AgX" if "AgX" in [i.identifier for i in scene.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"
bpy.ops.render.render(write_still=True)
print("PREVIEW", out)
