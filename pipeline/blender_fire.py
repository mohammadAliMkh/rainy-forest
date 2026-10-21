"""Runs INSIDE Blender: simulates a small campfire with Mantaflow and renders
it, frame by frame, from the front (pure emission on black, for additive
blending in the game). pipeline/fire_atlas.py packs the frames into a
flipbook texture.

    blender -b --factory-startup -P pipeline/blender_fire.py -- <frames_dir>
"""
import math
import os
import sys

import bpy

OUT = sys.argv[sys.argv.index("--") + 1]
os.makedirs(OUT, exist_ok=True)
CACHE = os.path.join(OUT, "cache")

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
FIRST, COUNT = 40, 64
scene.frame_start, scene.frame_end = 1, FIRST + COUNT

# ---- domain: 1.0 x 1.0 x 2.0 m ----
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.98))
domain = bpy.context.active_object
domain.scale = (1.0, 1.0, 2.0)
bpy.ops.object.transform_apply(scale=True)
mod = domain.modifiers.new("fluid", "FLUID")
mod.fluid_type = "DOMAIN"
ds = mod.domain_settings
ds.domain_type = "GAS"
ds.resolution_max = 96
ds.cache_directory = CACHE
ds.cache_type = "ALL"
ds.use_adaptive_domain = False
ds.vorticity = 0.85
ds.alpha = 1.0          # density buoyancy
ds.beta = 1.6           # heat buoyancy
ds.burning_rate = 1.15  # fuel burns at a rate that gives tongues ~3x the bed width
ds.flame_smoke = 0.15
ds.flame_vorticity = 1.2
ds.flame_ignition = 1.25
ds.flame_max_temp = 2.6
ds.use_dissolve_smoke = True
ds.dissolve_speed = 12

# ---- flow: a low log bed emitting fuel ----
bpy.ops.mesh.primitive_cylinder_add(radius=0.22, depth=0.1, location=(0, 0, 0.07))
flow = bpy.context.active_object
fm = flow.modifiers.new("fluid", "FLUID")
fm.fluid_type = "FLOW"
fs = fm.flow_settings
fs.flow_type = "FIRE"
fs.flow_behavior = "INFLOW"
fs.flow_source = "MESH"
fs.surface_distance = 0.6
fs.fuel_amount = 1.0
fs.use_initial_velocity = True
fs.velocity_coord = (0, 0, 0.5)
# a bit of flicker in the emission rate
fs.temperature = 1.4
flow.hide_render = True

with bpy.context.temp_override(active_object=domain, object=domain, selected_objects=[domain], scene=scene):
    bpy.ops.fluid.bake_all()
print("BAKED")

# ---- volume shader: fire only (blackbody), almost no smoke ----
mat = bpy.data.materials.new("fire")
mat.use_nodes = True
nt = mat.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
out = nt.nodes.new("ShaderNodeOutputMaterial")
# flame attribute -> color ramp (dark red at the edges, orange, yellow-white core)
attr = nt.nodes.new("ShaderNodeAttribute")
attr.attribute_name = "flame"
ramp = nt.nodes.new("ShaderNodeValToRGB")
cr = ramp.color_ramp
cr.elements[0].position = 0.08
cr.elements[0].color = (0, 0, 0, 1)
for pos, col in ((0.22, (0.35, 0.03, 0.0, 1)), (0.45, (1.0, 0.25, 0.02, 1)), (0.7, (1.0, 0.6, 0.12, 1))):
    e = cr.elements.new(pos)
    e.color = col
cr.elements[-1].position = 1.0
cr.elements[-1].color = (1.0, 0.92, 0.65, 1)
em = nt.nodes.new("ShaderNodeEmission")
em.inputs["Strength"].default_value = 6.0
nt.links.new(attr.outputs["Fac"], ramp.inputs["Fac"])
nt.links.new(ramp.outputs["Color"], em.inputs["Color"])
nt.links.new(em.outputs[0], out.inputs["Volume"])
domain.data.materials.append(mat)

# ---- camera: orthographic, front, framing the flames ----
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
cam.data.type = "ORTHO"
cam.data.ortho_scale = 1.9
cam.location = (0, -5, 0.92)
cam.rotation_euler = (math.radians(90), 0, 0)
scene.camera = cam
scene.world = bpy.data.worlds.new("w")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.cycles.volume_step_rate = 1.0
scene.render.resolution_x = 128
scene.render.resolution_y = 256
scene.render.film_transparent = False
scene.view_settings.view_transform = "Standard"
scene.render.image_settings.file_format = "PNG"
for i in range(COUNT):
    scene.frame_set(FIRST + i)
    scene.render.filepath = os.path.join(OUT, f"f{i:03d}.png")
    bpy.ops.render.render(write_still=True)
print("RENDERED", COUNT)
