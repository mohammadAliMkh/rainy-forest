"""Runs INSIDE Blender (with the MPFB extension in graphVenv/tools/blender_user):
one of the four friends at the fire as a rigged, textured human (.glb).

    set BLENDER_USER_RESOURCES=graphVenv/tools/blender_user
    blender -b --factory-startup -P pipeline/blender_people.py -- <key> <out.glb>

The body comes from MPFB / MakeHuman (CC0): phenotype and face shape
targets set per person (described by hand from the owner's photos; the
photos themselves are never part of the project), a scanned skin tinted
to their skin tone, eyes, brows, lashes, teeth, hair and clothes fitted to
the body, all weighted to MakeHuman's default skeleton. Short beards and
stubble are painted into the skin texture; full beards add a beard mesh.
Hat, sunglasses and earrings are modelled here and ride on the head bone.

Extra data for the game, stored on the armature (glTF extras, glTF axes):
  mouth  - the front of the lips (where a tea glass goes)
Morph targets on the body: blink, smile. The jaw bone opens the mouth.
"""
import math
import os
import random
import sys

import addon_utils
import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
KEY, OUT = argv[0], argv[1]
WORK = os.path.join(os.path.dirname(OUT), "people")
os.makedirs(WORK, exist_ok=True)

addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.user_default.mpfb.services.targetservice import TargetService  # noqa: E402
from bl_ext.user_default.mpfb.services.locationservice import LocationService  # noqa: E402
from bl_ext.user_default.mpfb.entities.objectproperties import GeneralObjectProperties  # noqa: E402

# ---------------------------------------------------------------------------
# the people. targets: MakeHuman modifier targets (name -> weight 0..1)
# colours are sRGB hex like the game's friendSpecs.js
PEOPLE = {
    # the owner: oval face with a high forehead, short thin dark hair
    # receding at the temples, thick straight dark brows, green-hazel eyes;
    # a light (sandy) beard: fuller mustache and chin, thin on the cheeks;
    # black puffer jacket, olive trousers, boots
    "owner": dict(
        phenotype=dict(gender=1.0, age=0.54, muscle=0.6, weight=0.58, proportions=0.6, height=0.55,
                       race=dict(caucasian=0.84, asian=0.04, african=0.12)),
        targets={"head-round": 0.3, "head-fat-incr": 0.35, "head-scale-horiz-incr": 0.2, "forehead-scale-vert-incr": 0.1,
                 "chin-width-incr": 0.35, "chin-height-decr": 0.1, "nose-scale-horiz-incr": 0.35, "nose-volume-incr": 0.2,
                 "nose-point-width-incr": 0.4, "nose-flaring-incr": 0.4, "mouth-lowerlip-volume-incr": 0.15, "mouth-upperlip-volume-incr": 0.05,
                 "eyebrows-trans-down": 0.35, "l-eye-eyefold-down": 0.5, "r-eye-eyefold-down": 0.5,
                 "l-eye-scale-decr": 0.15, "r-eye-scale-decr": 0.15, "l-eye-height2-decr": 0.35, "r-eye-height2-decr": 0.35,
                 "l-cheek-volume-incr": 0.3, "r-cheek-volume-incr": 0.3, "l-cheek-bones-incr": 0.2, "r-cheek-bones-incr": 0.2,
                 "l-ear-scale-incr": 0.15, "r-ear-scale-incr": 0.15},
        skin=0xd09a78, eyes=("green", "brownlight", 0.72), hair_color=0x2a1d14,
        eyebrows="eyebrow009", hair=None,
        scalp=dict(color=0x1b130d, density=1.0, front=0.056, temples=0.074),
        beard=dict(color=0x3d2614, density=1.0, strength=1.25, mustache=1.0, chin=1.0, cheeks=0.6, cheek_front=-0.014, cheek_ear=0.05, neck=0.35, stubble=0.05),
        clothes=[("male_casualsuit05", dict(top=0x17181b, bottom=0x434832)), ("shoes03", 0x1d1b19)],
    ),
    # Amir Esmaeil: tall, long face with a high forehead, strong straight nose,
    # deep-set dark eyes under heavy brows; black hair thin on top and slicked
    # back, wavy and falling to the shoulders behind the ears; a full black
    # "professor" beard pointed at the chin, shorter on the sides, thick
    # mustache; brown jacket, grey jeans
    "amir": dict(
        phenotype=dict(gender=1.0, age=0.58, muscle=0.55, weight=0.52, proportions=0.65, height=0.6,
                       race=dict(caucasian=0.8, asian=0.04, african=0.16)),
        targets={"head-oval": 0.3, "head-scale-vert-incr": 0.05, "forehead-scale-vert-incr": 0.2,
                 "nose-scale-vert-incr": 0.3, "nose-scale-depth-incr": 0.2, "nose-hump-incr": 0.15, "nose-point-down": 0.1,
                 "eyebrows-trans-down": 0.35, "eyebrows-trans-forward": 0.3, "l-eye-push1-in": 0.3, "r-eye-push1-in": 0.3,
                 "l-eye-bag-incr": 0.4, "r-eye-bag-incr": 0.4, "l-eye-height2-decr": 0.15, "r-eye-height2-decr": 0.15,
                 "chin-height-incr": 0.15, "l-cheek-bones-incr": 0.3, "r-cheek-bones-incr": 0.3},
        skin=0xc89478, eyes="brown", hair_color=0x120d0a,
        eyebrows="eyebrow009", hair="o4saken_long01",
        # long hair slicked flat over the top (the thin scalp shows through), ends at the shoulders
        hair_slick=dict(above=0.0, front_of=0.17, gap=0.004, bottom=-0.21, face_back=0.09, face_top=0.065,
                        brow_back=0.05, brow_top=0.09),
        scalp=dict(color=0x100b08, density=0.85, front=0.085, temples=0.095),
        beard=dict(color=0x1a1310, density=1.0, strength=1.3, mustache=1.0, chin=1.0, cheeks=1.0, cheek=0.7, neck=0.8, stubble=0.15,
                   mesh="grinsegold_beard_sigmund_wip"),
        clothes=[("male_casualsuit01", dict(top=0x6e4528, bottom=0x4d5054)), ("toigo_ankle_boots_male", 0xc08a48)],
    ),
    # Amin: head shaved short and receding (under his leather outback hat),
    # a thick bushy curly black beard that reaches high on the cheeks and well
    # below the chin, thick dark brows, big brown eyes, ears that stand out a
    # little, two small hoops in his left ear, a heavy silver chain, tattoos on
    # his neck, arms and the backs of his hands; black t-shirt
    "amin": dict(
        phenotype=dict(gender=1.0, age=0.55, muscle=0.6, weight=0.5, proportions=0.6, height=0.56,
                       race=dict(caucasian=0.8, asian=0.04, african=0.16)),
        targets={"head-oval": 0.3, "forehead-scale-vert-incr": 0.2, "nose-scale-vert-incr": 0.2, "nose-point-width-incr": 0.15,
                 "nose-hump-incr": 0.1, "l-eye-scale-incr": 0.15, "r-eye-scale-incr": 0.15, "eyebrows-trans-down": 0.1,
                 "l-cheek-bones-incr": 0.25, "r-cheek-bones-incr": 0.25, "l-ear-scale-incr": 0.2, "r-ear-scale-incr": 0.2,
                 "l-ear-flap-incr": 0.25, "r-ear-flap-incr": 0.25},
        skin=0xd6a487, eyes="brown", hair_color=0x110b09,
        eyebrows="eyebrow009", hair=None,
        scalp=dict(color=0x1a1410, density=0.5, front=0.075, temples=0.095),
        beard=dict(color=0x0d0a08, density=1.0, strength=1.3, mustache=1.0, chin=1.0, cheeks=1.0, cheek=0.75, neck=0.9, stubble=0.1,
                   mesh="wdg_scruffy_beard", widen=1.22),
        clothes=[("toigo_basic_tucked_t-shirt", 0x141416), ("toigo_wool_pants", 0x2b2723), ("shoes03", 0x3b2819)],
        hat=0x5b3b22, earrings=dict(side=1, count=2), chain=0xc8ccd0,
        tattoos=[("forearm", "R", "knot_a"), ("forearm", "L", "knot_b"), ("upperarm", "R", "eagle"), ("upperarm", "L", "knot_a"),
                 ("hand", "R", "skull"), ("hand", "L", "spider"), ("neck", "R", "knot_b")],
    ),
    # Alireza: fair skin, near-black eyes, oval face with a straight nose,
    # thick dark brown hair full on top and short at the sides, a light sandy
    # beard and mustache (fuller on the lip and chin, light on the cheeks);
    # olive t-shirt, dark jeans
    "alireza": dict(
        phenotype=dict(gender=1.0, age=0.5, muscle=0.5, weight=0.55, proportions=0.6, height=0.56,
                       race=dict(caucasian=0.92, asian=0.03, african=0.05)),
        targets={"head-oval": 0.2, "head-fat-incr": 0.15, "head-scale-horiz-incr": 0.12, "l-cheek-volume-incr": 0.2, "r-cheek-volume-incr": 0.2,
                 "nose-scale-vert-incr": 0.15, "nose-point-width-incr": 0.1, "nose-scale-depth-incr": 0.1,
                 "l-eye-height2-decr": 0.25, "r-eye-height2-decr": 0.25, "l-eye-eyefold-down": 0.25, "r-eye-eyefold-down": 0.25,
                 "eyebrows-trans-down": 0.15, "mouth-lowerlip-volume-incr": 0.1, "chin-width-incr": 0.25},
        skin=0xe6c0a6, eyes="brown", iris_dark=0.35, hair_color=0x4a3324,
        eyebrows="eyebrow009", hair="culturalibre_hair_05",
        # swept up and back: nothing over the forehead, short sides, more lift on top
        hair_style=dict(fringe_back=0.06, fringe_top=0.072, side_back=0.1, side_top=0.02, lift=1.12),
        scalp=dict(color=0x3a281a, density=0.92, front=0.066, temples=0.072),
        beard=dict(color=0x76522f, density=1.0, strength=1.15, mustache=1.0, chin=0.85, cheeks=0.45, cheek=0.35, neck=0.6, stubble=0.15),
        clothes=[("male_casualsuit06", dict(top=0x3e4229, bottom=0x24272d)), ("shoes02", 0x5a4632)],
    ),
    # Farajpour, the shopkeeper: short and round with a belly, bald on top
    # with black tufts above the ears, a round smiling face with full cheeks,
    # big brown eyes under thick black brows, a thick black moustache curled
    # up at the ends; a red long-sleeved shirt under a dark navy vest
    "farajpour": dict(
        phenotype=dict(gender=1.0, age=0.62, muscle=0.05, weight=1.0, proportions=0.3, height=0.32,
                       race=dict(caucasian=0.75, asian=0.1, african=0.15)),
        targets={"head-round": 1.0, "head-fat-incr": 1.0, "head-scale-horiz-incr": 0.4, "head-scale-vert-decr": 0.45,
                 "forehead-scale-vert-decr": 0.4,
                 "chin-height-decr": 0.25, "l-cheek-volume-incr": 1.0, "r-cheek-volume-incr": 1.0, "neck-double-incr": 1.0,
                 "nose-volume-incr": 0.6, "nose-point-width-incr": 0.6, "nose-scale-horiz-incr": 0.35, "nose-scale-vert-decr": 0.15,
                 "l-eye-scale-incr": 0.2, "r-eye-scale-incr": 0.2, "mouth-scale-horiz-incr": 0.15,
                 "l-ear-scale-incr": 0.15, "r-ear-scale-incr": 0.15, "stomach-pregnant-incr": 0.7,
                 "measure-waist-circ-incr": 0.6, "torso-scale-depth-incr": 0.4},
        skin=0xe3a07a, eyes="brown", hair_color=0x0e0b0a,
        eyebrows="eyebrow009", hair=None,
        scalp=dict(color=0x120e0c, density=0.9, front=0.2, temples=0.2, bald=0.055),
        tufts=dict(color=0x0e0b0a),
        moustache=dict(color=0x0e0b0a),
        beard=dict(color=0x120e0c, density=1.0, strength=1.1, mustache=1.0, chin=0.0, cheeks=0.0, cheek=0.0, neck=0.0, stubble=0.0),
        clothes=[("toigo_fisherman_sweater", dict(shirt=0xb8261b, vest=0x1b2236)), ("toigo_wool_pants", 0x2a2a30), ("shoes03", 0x161412)],
    ),
}
P = PEOPLE[KEY]



def enc(hexv):
    """sRGB-encoded 0..1 (what image.pixels holds for a PNG): targets for texture tints"""
    return np.array([((hexv >> s) & 255) / 255 for s in (16, 8, 0)])


def lin(hexv):
    """linear 0..1: flat material colours"""
    return np.array([x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in enc(hexv)])


# ======================= build the human with MPFB ==========================
info = HumanService._create_default_human_info_dict()
info["phenotype"] = dict(P["phenotype"], cupsize=0.5, firmness=0.5)
info["targets"] = [{"target": k, "value": v} for k, v in P["targets"].items()]
info["eyes"] = "low-poly.mhclo"
info["eyebrows"] = P["eyebrows"] + ".mhclo"
info["eyelashes"] = "eyelashes02.mhclo"
info["teeth"] = "teeth_base.mhclo"
info["hair"] = P["hair"] + ".mhclo" if P.get("hair") else ""
info["skin_mhmat"] = "middleage_caucasian_male.mhmat"
info["skin_material_type"] = "MAKESKIN"
info["eyes_material_type"] = "MAKESKIN"
info["rig"] = "default"
info["alternative_materials"] = {}
assets = [name + ".mhclo" for name, _ in P["clothes"]]
if P["beard"].get("mesh"):
    assets.append(P["beard"]["mesh"] + ".mhclo")
info["clothes"] = assets
settings = HumanService.get_default_deserialization_settings()
settings.update(subdiv_levels=0, material_instances="NEVER", load_clothes=True)
body = HumanService.deserialize_from_dict(info, settings)
rig = body.parent
rig.name = rig.data.name = KEY
body.name = "body"
print("built", body.name, rig.name, [c.name for c in rig.children])

# collapse the shape targets into the mesh
bpy.ops.object.select_all(action="DESELECT")
bpy.context.view_layer.objects.active = body
body.select_set(True)
if body.data.shape_keys:
    bpy.ops.object.shape_key_remove(all=True, apply_mix=True)

# ======================= landmarks ==========================================
vg = {g.name: g.index for g in body.vertex_groups}


def group_center(name):
    idx = vg[name]
    pts = [v.co for v in body.data.vertices if any(g.group == idx and g.weight > 0.5 for g in v.groups)]
    return sum(pts, Vector()) / len(pts)


def bone_head(n):
    return rig.matrix_world @ rig.data.bones[n].head_local


def bone_tail(n):
    return rig.matrix_world @ rig.data.bones[n].tail_local


# between the lips (upper lip: oris05, lower lip: oris01), chin: special04
MOUTH = (bone_head("oris05") + bone_tail("oris01")) / 2
CHIN_Z = bone_head("special04").z
EYE_L, EYE_R = group_center("joint-l-eye"), group_center("joint-r-eye")
EYE_Z = (EYE_L.z + EYE_R.z) / 2
HEAD_BONE = rig.data.bones["head"]
head_idx = vg.get("head")
body_idx = vg["body"]


def weight(v, idx):
    for g in v.groups:
        if g.group == idx:
            return g.weight
    return 0.0


head_verts = [v for v in body.data.vertices if weight(v, body_idx) > 0.5 and head_idx is not None and weight(v, head_idx) > 0.3]
HEAD_TOP = max(v.co.z for v in head_verts)
# front of the lips: the most forward (-Y) body vertex right at the mouth
LIPS = Vector((0.0, MOUTH.y - 0.008, MOUTH.z))
print("landmarks mouth", tuple(round(c, 3) for c in LIPS), "eyes z", round(EYE_Z, 3), "top", round(HEAD_TOP, 3))

# ======================= expression morphs ==================================
UNITS = os.path.join(LocationService.get_mpfb_data("targets"), "expression", "units", "caucasian")


def add_expression(name, parts):
    keys = []
    for unit, w in parts:
        TargetService.load_target(body, os.path.join(UNITS, unit + ".target.gz"), weight=w, name="tmp_" + unit)
    for kb in body.data.shape_keys.key_blocks:
        if kb.name.startswith("tmp_"):
            keys.append(kb)
    sk = body.shape_key_add(name=name, from_mix=True)
    for kb in keys:
        body.shape_key_remove(kb)
    sk.value = 0.0


if not body.data.shape_keys:
    body.shape_key_add(name="Basis")
add_expression("blink", [("eye-left-closure", 1.0), ("eye-right-closure", 1.0)])
add_expression("smile", [("mouth-corner-puller", 0.9), ("mouth-upward-retraction", 0.25), ("eye-left-slit", 0.25), ("eye-right-slit", 0.25)])

# ======================= drop helper geometry and hidden body ===============
keep_groups = {body_idx}
bm = bmesh.new()
bm.from_mesh(body.data)
deform = bm.verts.layers.deform.active
hidden = set()
for m in body.modifiers:  # MPFB hides skin under clothes with masks
    if m.type == "MASK" and m.vertex_group and m.vertex_group != "body":
        hidden.add(vg.get(m.vertex_group))
dead = []
for v in bm.verts:
    d = v[deform]
    if d.get(body_idx, 0.0) < 0.5 or any(d.get(h, 0.0) > 0.5 for h in hidden if h is not None):
        dead.append(v)
bmesh.ops.delete(bm, geom=dead, context="VERTS")
bm.to_mesh(body.data)
bm.free()
for m in list(body.modifiers):
    if m.type != "ARMATURE":
        body.modifiers.remove(m)
for g in list(body.vertex_groups):
    if g.name.startswith(("helper-", "joint-")) or g.name in ("HelperGeometry", "JointCubes", "body", "Left", "Right", "Mid"):
        body.vertex_groups.remove(g)
print("body verts", len(body.data.vertices))
# the mesh changed: look the head vertices up again (group indices moved too)
_hg = body.vertex_groups["head"].index
head_verts = [v for v in body.data.vertices if weight(v, _hg) > 0.3]


# ======================= textures and materials =============================
def mhmat_for(obj):
    """the .mhmat that MPFB used for an object"""
    src = GeneralObjectProperties.get_value("asset_source", entity_reference=obj)
    if obj is body:
        from bl_ext.user_default.mpfb.services.assetservice import AssetService
        return AssetService.find_asset_absolute_path("middleage_caucasian_male.mhmat", "skins")
    if not src:
        return None
    from bl_ext.user_default.mpfb.services.assetservice import AssetService
    for sub in ("clothes", "hair", "eyebrows", "eyelashes", "eyes", "teeth"):
        p = AssetService.find_asset_absolute_path(os.path.basename(str(src)), sub)
        if p:
            folder = os.path.dirname(p)
            mats = [f for f in os.listdir(folder) if f.endswith(".mhmat")]
            with open(p, encoding="utf8", errors="ignore") as f:
                for line in f:
                    if line.startswith("material "):
                        return os.path.join(folder, line.split(None, 1)[1].strip())
            return os.path.join(folder, mats[0]) if mats else None
    return None


def parse_mhmat(path):
    out = {}
    if not path or not os.path.isfile(path):
        return out
    folder = os.path.dirname(path)
    with open(path, encoding="utf8", errors="ignore") as f:
        for line in f:
            parts = line.strip().split(None, 1)
            if len(parts) == 2:
                k, v = parts
                if k.endswith("Texture"):
                    out[k] = os.path.join(folder, v.strip()) if not os.path.isabs(v.strip()) else v.strip()
                else:
                    out[k] = v.strip()
    return out


def load_pixels(path, size):
    img = bpy.data.images.load(path, check_existing=False)
    if size and max(img.size) > size:
        img.scale(size, size)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    return img, px.reshape(h, w, 4)


def save_image(img, arr, name):
    h, w = arr.shape[:2]
    out = bpy.data.images.new(name, w, h, alpha=True)
    out.pixels.foreach_set(arr.astype(np.float32).ravel())
    out.filepath_raw = os.path.join(WORK, f"{KEY}_{name}.png")
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(img)
    return out


def tint(arr, target, keep=0.35, region=None):
    """recolour a texture toward `target` (linear RGB) keeping its shading detail"""
    rgb = arr[..., :3]
    mask = arr[..., 3] > 0.5 if region is None else region > 0.5
    mean = rgb[mask].mean(axis=0) if mask.any() else rgb.reshape(-1, 3).mean(axis=0)
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722])
    mlum = float(mean @ np.array([0.2126, 0.7152, 0.0722])) or 1e-3
    detail = np.clip(lum / mlum, 0, 2.2)[..., None]
    graded = target[None, None, :] * detail
    hue_kept = rgb * (target / np.maximum(mean, 1e-3))[None, None, :]
    arr[..., :3] = np.clip(graded * (1 - keep) + hue_kept * keep, 0, 1)
    return arr


def principled(name, img=None, color=None, alpha=False, roughness=0.7, normal=None, metallic=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if img:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = img
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha:
            nt.links.new(t.outputs["Alpha"], bsdf.inputs["Alpha"])
    elif color is not None:
        bsdf.inputs["Base Color"].default_value = (*color, 1)
    if normal:
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = normal
        n.image.colorspace_settings.name = "Non-Color"
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = 0.6
        nt.links.new(n.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def kind_of(obj):
    t = str(GeneralObjectProperties.get_value("object_type", entity_reference=obj) or "")
    return t.lower()


# ---- skin, with the beard painted in
skin_info = parse_mhmat(mhmat_for(body))
skin_img, skin = load_pixels(skin_info["diffuseTexture"], 2048)
_t = enc(P["skin"])
_t = np.clip((_t * 0.85 + float(_t @ np.array([0.2126, 0.7152, 0.0722])) * 0.15) * 1.04, 0, 1)
skin = tint(skin, _t, keep=0.5)


def smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def beard_weight(co):
    b = P["beard"]
    lx = abs(co.x)
    up = co.z - MOUTH.z
    back = co.y - MOUTH.y  # how far behind the lips
    eye_h = EYE_Z - MOUTH.z
    # top edge: just under the nose at the front, rising along the cheek to the sideburn
    t = smooth(0.012, 0.085, back)
    if "cheek_front" in b:
        # beard along the jaw: below the mouth corners at the front, rising to the sideburns
        t = smooth(0.02, 0.085, back)
        top = b["cheek_front"] + (b["cheek_ear"] - b["cheek_front"]) * t
    else:
        top = 0.021 + t * eye_h * (0.3 + 0.9 * b["cheek"]) + smooth(0.0, 0.03, lx) * 0.004
    w = 1.0 - smooth(top - 0.005, top + 0.005, up)
    # the mustache: from under the nose down past the mouth corners
    must = smooth(0.002, 0.007, up + smooth(0.02, 0.034, lx) * 0.012) * (1.0 - smooth(0.019, 0.025, up))         * (1.0 - smooth(0.031, 0.04, lx)) * (1.0 - smooth(0.02, 0.04, back))
    w = max(w, must)
    # stop at the front of the ear
    w *= 1.0 - smooth(0.085, 0.1, back)
    # under the chin down onto the neck
    low = CHIN_Z - MOUTH.z - 0.015 - 0.035 * b["neck"]
    w *= smooth(low - 0.012, low + 0.004, up)
    # bare lips
    lip = (co.x / 0.025) ** 2 + (up / 0.0092) ** 2
    if lip < 1.0 and back < 0.03:
        w *= smooth(0.55, 1.0, lip)
    # how full each part is: mustache above the lip, chin below it, cheeks/jaw around
    z_m = smooth(0.003, 0.01, up) * (1.0 - smooth(0.026, 0.04, lx)) * (1.0 - smooth(0.02, 0.04, back))
    z_c = (1.0 - smooth(-0.006, 0.004, up)) * (1.0 - smooth(0.028, 0.05, lx)) * (1.0 - smooth(0.03, 0.06, back))
    z_k = max(0.0, 1.0 - z_m - z_c)
    full = b.get("mustache", 1.0) * z_m + b.get("chin", 1.0) * z_c + b.get("cheeks", 1.0) * z_k
    return max(0.0, min(1.0, w)) * full


def raster(obj, vw, H, W):
    """paint per-vertex values `vw` (index -> 0..1) into the object's UV space"""
    mask = np.zeros((H, W), dtype=np.float32)
    uv = obj.data.uv_layers.active.data
    me = obj.data
    for poly in me.polygons:
        vids = list(poly.vertices)
        if not any(vw.get(i, 0) > 0 for i in vids):
            continue
        loops = list(poly.loop_indices)
        for k in range(1, len(vids) - 1):
            tri = [0, k, k + 1]
            P2 = np.array([[uv[loops[t]].uv[0] * W, uv[loops[t]].uv[1] * H] for t in tri])
            ww = np.array([vw.get(vids[t], 0.0) for t in tri])
            x0, y0 = np.floor(P2.min(axis=0)).astype(int)
            x1, y1 = np.ceil(P2.max(axis=0)).astype(int)
            x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, W - 1), min(y1, H - 1)
            if x1 < x0 or y1 < y0:
                continue
            xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            (ax, ay), (bx, by), (cx, cy) = P2
            den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(den) < 1e-9:
                continue
            l1 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den
            l2 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den
            l3 = 1 - l1 - l2
            inside = (l1 >= -0.01) & (l2 >= -0.01) & (l3 >= -0.01)
            val = l1 * ww[0] + l2 * ww[1] + l3 * ww[2]
            sub = mask[y0:y1 + 1, x0:x1 + 1]
            sub[inside] = np.maximum(sub[inside], val[inside])
    return mask


def island_tops(obj, split_z):
    """per polygon: 1 if its UV island (one piece of cloth) sits above split_z on average"""
    me = obj.data
    uv = me.uv_layers.active.data
    parent = list(range(len(me.polygons)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    seen = {}
    for poly in me.polygons:
        for li in poly.loop_indices:
            key = (me.loops[li].vertex_index, round(uv[li].uv[0], 4), round(uv[li].uv[1], 4))
            if key in seen:
                parent[find(poly.index)] = find(seen[key])
            else:
                seen[key] = poly.index
    zs = {}
    for poly in me.polygons:
        r = find(poly.index)
        acc = zs.setdefault(r, [0.0, 0])
        acc[0] += poly.center.z
        acc[1] += 1
    return {poly.index: 1.0 if zs[find(poly.index)][0] / zs[find(poly.index)][1] > split_z else 0.0 for poly in me.polygons}


def raster_faces(obj, pv, H, W):
    """paint one value per polygon into UV space"""
    vw_dummy = None
    mask = np.zeros((H, W), dtype=np.float32)
    uv = obj.data.uv_layers.active.data
    for poly in obj.data.polygons:
        val = pv[poly.index]
        if val <= 0:
            continue
        loops = list(poly.loop_indices)
        for k in range(1, len(loops) - 1):
            P2 = np.array([[uv[loops[t]].uv[0] * W, uv[loops[t]].uv[1] * H] for t in (0, k, k + 1)])
            x0, y0 = np.floor(P2.min(axis=0)).astype(int)
            x1, y1 = np.ceil(P2.max(axis=0)).astype(int)
            x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, W - 1), min(y1, H - 1)
            if x1 < x0 or y1 < y0:
                continue
            xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            (ax, ay), (bx, by), (cx, cy) = P2
            den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(den) < 1e-9:
                continue
            l1 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den
            l2 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den
            inside = (l1 >= -0.02) & (l2 >= -0.02) & (1 - l1 - l2 >= -0.02)
            mask[y0:y1 + 1, x0:x1 + 1][inside] = val
    return mask


def blur(mask, r):
    from numpy.lib.stride_tricks import sliding_window_view as swv
    pad = np.pad(mask, r, mode="edge")
    return swv(pad, (2 * r + 1, 2 * r + 1)).mean(axis=(2, 3))


def scalp_weight(co):
    """short hair painted on the scalp: above the hairline (receding at the
    temples), down the sides to above the ears and the back to the nape"""
    c = P["scalp"]
    lx = abs(co.x)
    up = co.z - EYE_Z
    back = co.y - MOUTH.y
    front = c["front"] + (c["temples"] - c["front"]) * smooth(0.012, 0.042, lx)
    t = smooth(0.05, 0.14, back)  # from the forehead round to the back of the head
    line = front * (1.0 - t) + (-0.075) * t
    w = smooth(line - 0.003, line + 0.008, up)
    if c.get("bald") is not None:  # a bald crown: hair only round the sides and the back
        w = smooth(-0.075 - 0.003, -0.075 + 0.008, up) * (1.0 - smooth(c["bald"] - 0.012, c["bald"] + 0.006, up))
        w *= smooth(0.035, 0.07, back)  # nothing on the forehead / temples
    # bare around the ears
    if lx > 0.055 and 0.06 < back < 0.13 and up < 0.035:
        w *= smooth(0.02, 0.035, up)
    # sideburns stop short of the beard line
    if back < 0.1 and up < 0.02:
        w *= smooth(-0.005, 0.02, up)
    return max(0.0, min(1.0, w))


rng = np.random.default_rng(7)
H, W = skin.shape[:2]
grain = rng.random((H, W)).astype(np.float32)
if P.get("scalp"):
    c = P["scalp"]
    vw = {v.index: scalp_weight(v.co) for v in body.data.vertices if v.co.z > EYE_Z - 0.09}
    mask = blur(raster(body, vw, H, W), 4)
    dots = np.clip((blur(grain, 1) - 0.42) * 4.0, 0, 1)  # short hairs: fine dark dots with scalp between
    cover = np.clip(mask * c["density"] * (0.8 + 0.2 * dots), 0, 0.96)[..., None]
    skin[..., :3] = skin[..., :3] * (1 - cover) + enc(c["color"])[None, None, :] * cover
b = P["beard"]
if b["density"] > 0:
    H, W = skin.shape[:2]
    vw = {}
    for v in body.data.vertices:
        if abs(v.co.z - MOUTH.z) < 0.16 and -(v.co.y - MOUTH.y) > -0.13:
            vw[v.index] = beard_weight(v.co)
    mask = blur(raster(body, vw, H, W), 3)
    streak = sum(np.roll(grain, k, axis=1) for k in range(5)) / 5  # short hairs along the growth direction
    hairs = np.clip((streak - 0.3) * 2.0, 0, 1)
    cover = mask * (b["density"] * (0.55 + 0.45 * hairs) + b["stubble"] * 0.25) * b.get("strength", 1.0)
    cover = np.clip(cover, 0, 0.96)[..., None]
    col = enc(b["color"])[None, None, :]
    skin[..., :3] = skin[..., :3] * (1 - cover) + col * cover
# ---- tattoos: black-and-grey ink lifted from MakeHuman's CC0 tattooed skins,
# stamped on the skin at places found from the bones (rest pose: palms down)
SKINS = os.path.join(LocationService.get_user_data(), "skins")
INK = {  # source texture, box in the image (fractions, top-down)
    "knot_a": ("rehmanpolanski_skin_viking_tattoos/viking_male_diffuse.png", (0.214, 0.029, 0.343, 0.179)),
    "knot_b": ("rehmanpolanski_skin_viking_tattoos/viking_male_diffuse.png", (0.429, 0.029, 0.55, 0.179)),
    "eagle": ("ken1138_caucasian_male_tattooed_skin/Caucasion_TatooedMale_Skin_Difuse.png", (0.271, 0.15, 0.486, 0.279)),
    "skull": ("ken1138_caucasian_male_tattooed_skin/Caucasion_TatooedMale_Skin_Difuse.png", (0.571, 0.714, 0.636, 0.796)),
    "spider": ("ken1138_caucasian_male_tattooed_skin/Caucasion_TatooedMale_Skin_Difuse.png", (0.114, 0.131, 0.169, 0.174)),
}
SITE_SIZE = {"forearm": 0.13, "upperarm": 0.1, "hand": 0.05, "neck": 0.06}


def ink_of(name):
    path, (x0, y0, x1, y1) = INK[name]
    img, arr = load_pixels(os.path.join(SKINS, path), 2048)
    H_, W_ = arr.shape[:2]
    crop = arr[int((1 - y1) * H_):int((1 - y0) * H_), int(x0 * W_):int(x1 * W_), :3]
    bpy.data.images.remove(img)
    lum = crop @ np.array([0.2126, 0.7152, 0.0722])
    return np.clip((blur(lum, 10) - lum) * 9.0 - 0.05, 0, 1)  # darker than the skin around it = ink


def tattoo_site(site, side):
    """(anchor vertex, a second point along the limb) on the body"""
    verts = body.data.vertices
    if site == "neck":
        n = bone_head("neck01")
        sx = 1 if side == "L" else -1
        cand = [v for v in verts if abs(v.co.z - (n.z - 0.01)) < 0.02 and abs(v.co.y - n.y) < 0.04 and v.co.x * sx > 0]
        if not cand:
            return None
        a = max(cand, key=lambda v: v.co.x * sx)
        return a, a.co + Vector((0, 0, 0.04))
    if site == "forearm":
        p0, p1 = bone_head("lowerarm01." + side), bone_head("wrist." + side)
        mid = p0.lerp(p1, 0.5)
    elif site == "upperarm":
        p0, p1 = bone_head("upperarm01." + side), bone_head("lowerarm01." + side)
        mid = p0.lerp(p1, 0.78)  # below the sleeve
    else:
        p0, p1 = bone_head("wrist." + side), bone_head("finger3-1." + side)
        mid = p0.lerp(p1, 0.5)
    cand = [v for v in verts if (v.co - mid).length < 0.06]
    if not cand:
        return None
    a = max(cand, key=lambda v: v.co.z - (v.co - mid).length * 0.5)  # the top (outer) side
    return a, a.co + (p1 - p0).normalized() * 0.04


def stamp(arr, ink, uv0, uv1, d3, size_m, color, strength=0.85):
    """ink's long side runs from uv0 toward uv1 (d3 metres apart on the body)"""
    H_, W_ = arr.shape[:2]
    p0 = np.array([uv0[0] * W_, uv0[1] * H_])
    p1 = np.array([uv1[0] * W_, uv1[1] * H_])
    px_per_m = np.linalg.norm(p1 - p0) / d3
    ang = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
    ih, iw = ink.shape
    long_ = max(ih, iw)
    sc = size_m * px_per_m / long_
    if iw < ih:  # long side of the art along the limb
        ink = ink.T[::-1]
        ih, iw = ink.shape
    half = int(long_ * sc * 0.75) + 2
    cx, cy = p0
    ys, xs = np.mgrid[int(cy) - half:int(cy) + half, int(cx) - half:int(cx) + half]
    ok = (ys >= 0) & (ys < H_) & (xs >= 0) & (xs < W_)
    ys, xs = ys[ok], xs[ok]
    dx, dy = xs - cx, ys - cy
    u = (dx * math.cos(ang) + dy * math.sin(ang)) / sc + iw / 2
    v = (-dx * math.sin(ang) + dy * math.cos(ang)) / sc + ih / 2
    inside = (u >= 0) & (u < iw - 1) & (v >= 0) & (v < ih - 1)
    ys, xs, u, v = ys[inside], xs[inside], u[inside], v[inside]
    a = ink[v.astype(int), u.astype(int)][:, None] * strength
    arr[ys, xs, :3] = arr[ys, xs, :3] * (1 - a) + color[None, :] * a


if P.get("tattoos"):
    me = body.data
    uvl = me.uv_layers.active.data
    vuv = {}
    for lp in me.loops:
        vuv.setdefault(lp.vertex_index, tuple(uvl[lp.index].uv))
    from mathutils.kdtree import KDTree
    tree = KDTree(len(me.vertices))
    for v in me.vertices:
        tree.insert(v.co, v.index)
    tree.balance()
    inks = {}
    for site, side, art in P["tattoos"]:
        at = tattoo_site(site, side)
        if not at:
            print("no skin for tattoo", site, side)
            continue
        a, toward = at
        j = next((i for _, i, _ in tree.find_n(toward, 4) if i != a.index), None)
        if j is None:
            continue
        if art not in inks:
            inks[art] = blur(ink_of(art), 1)
        stamp(skin, inks[art], vuv[a.index], vuv[j], (me.vertices[j].co - a.co).length, SITE_SIZE[site], enc(0x14181e), 0.92)
        print("tattoo", art, "on", site, side)
skin_tex = save_image(skin_img, skin, "skin")
nrm = None
_nrm = os.path.join(LocationService.get_user_data(), "skins", "mindfront_aksel_skin", "Aksel_Skin_NRM.png")
if os.path.isfile(_nrm):
    nrm = bpy.data.images.load(_nrm)
    if max(nrm.size) > 1024:
        nrm.scale(1024, 1024)
body.data.materials.clear()
body.data.materials.append(principled("skin", skin_tex, roughness=0.55, normal=nrm))

# ---- everything MPFB fitted to the body
slot_color = dict(P["clothes"])
WAIST_Z = rig.data.bones["upperleg01.L"].head_local.z
def trim_hair(obj, t):
    """keep only hair behind the ears and below the crown, down to the shoulders"""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    dead = []
    for v in bm.verts:
        co = obj.matrix_world @ v.co
        back = co.y - MOUTH.y
        up = co.z - EYE_Z
        keep = (back > t["back"] and up < t.get("top", 1.0)) or (back > t["side_back"] and up < t["side_top"])
        if not keep or co.z - MOUTH.z < t["bottom"]:
            dead.append(v)
    bmesh.ops.delete(bm, geom=dead, context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()


def slick_hair(obj, t):
    """press the hair over the top and front flat onto the scalp (slicked back),
    and cut the ends at the shoulders"""
    from mathutils.kdtree import KDTree
    tree = KDTree(len(head_verts))
    for k, v in enumerate(head_verts):
        tree.insert(v.co, k)
    tree.balance()
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    mw, inv = obj.matrix_world, obj.matrix_world.inverted()
    dead = []
    for v in bm.verts:
        co = mw @ v.co
        # nothing hangs over the face: strands in front of the ears below the hairline go
        back, up = co.y - MOUTH.y, co.z - EYE_Z
        if co.z - MOUTH.z < t["bottom"] or (back < t["face_back"] and up < t["face_top"])                 or (back < t.get("brow_back", -1) and up < t.get("brow_top", -1)):  # clean forehead hairline
            dead.append(v)
            continue
        if co.z - EYE_Z > t["above"] and co.y - MOUTH.y < t["front_of"]:
            near, _, dist = tree.find(co)
            if dist > t["gap"]:
                v.co = inv @ (near + (co - near).normalized() * t["gap"])
    bmesh.ops.delete(bm, geom=dead, context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()


for obj in list(rig.children):
    if obj is body or obj.type != "MESH":
        continue
    kind = kind_of(obj)
    if "beard" in obj.name.lower() and P["beard"].get("widen"):
        k_ = P["beard"]["widen"]
        for v in obj.data.vertices:  # wider at the jaw and below, the mouth stays put
            co = obj.matrix_world @ v.co
            f = 1 + (k_ - 1) * smooth(0.01, -0.03, co.z - MOUTH.z)
            v.co.x = (obj.matrix_world.inverted() @ Vector((co.x * f, co.y, co.z))).x
    if kind == "hair" and P.get("hair_trim"):
        trim_hair(obj, P["hair_trim"])
    if kind == "hair" and P.get("hair_slick"):
        slick_hair(obj, P["hair_slick"])
    if kind == "hair" and P.get("hair_style"):
        t_ = P["hair_style"]
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        mw, inv = obj.matrix_world, obj.matrix_world.inverted()
        dead = []
        for v in bm.verts:
            co = mw @ v.co
            back, up = co.y - MOUTH.y, co.z - EYE_Z
            if (back < t_["fringe_back"] and up < t_["fringe_top"]) or (back < t_["side_back"] and up < t_["side_top"]):
                dead.append(v)
            elif up > 0.07:  # volume on top
                v.co = inv @ Vector((co.x, co.y, EYE_Z + 0.07 + (up - 0.07) * t_["lift"]))
        bmesh.ops.delete(bm, geom=dead, context="VERTS")
        bm.to_mesh(obj.data)
        bm.free()
    info_m = parse_mhmat(mhmat_for(obj))
    src = str(GeneralObjectProperties.get_value("asset_source", entity_reference=obj) or obj.name)
    base = os.path.splitext(os.path.basename(src))[0]
    tex = info_m.get("diffuseTexture")
    if kind == "eyes":
        e = P["eyes"] if isinstance(P["eyes"], tuple) else (P["eyes"],)
        tex = os.path.join(LocationService.get_user_data(), "eyes", "materials", e[0] + "_eye.png")
        if len(e) > 1:  # mix two iris textures
            img_a, a = load_pixels(tex, 512)
            img_b, bb = load_pixels(os.path.join(LocationService.get_user_data(), "eyes", "materials", e[1] + "_eye.png"), 512)
            a[..., :3] = a[..., :3] * (1 - e[2]) + bb[..., :3] * e[2]
            bpy.data.images.remove(img_b)
            tex = os.path.join(WORK, f"{KEY}_iris.png")
            save_image(img_a, a, "iris")
        if P.get("iris_dark"):  # darker irises (the white of the eye stays)
            img_a, a = load_pixels(tex, 512)
            lum = a[..., :3] @ np.array([0.2126, 0.7152, 0.0722])
            iris = (1.0 - np.clip((lum - 0.35) / 0.25, 0, 1))[..., None]
            a[..., :3] = a[..., :3] * (1 - iris * (1 - P["iris_dark"]))
            tex = os.path.join(WORK, f"{KEY}_iris.png")
            save_image(img_a, a, "iris")
    size = 1024 if kind in ("clothes", "hair") else 512
    alpha = kind in ("hair", "eyebrows", "eyelashes") or "beard" in base
    color = None  # hex, or dict(top=hex, bottom=hex)
    if kind == "hair" or kind == "eyebrows" or "beard" in base:
        color = P["beard"]["color"] if "beard" in base else P["hair_color"]
    elif kind == "clothes":
        color = slot_color.get(base, 0x333333)
    img = None
    if tex and os.path.isfile(tex):
        img0, arr = load_pixels(tex, size)
        if isinstance(color, dict) and "vest" in color:
            # a vest over the shirt: the torso (not the sleeves), open down the front
            H, W = arr.shape[:2]
            from mathutils.geometry import intersect_point_line
            arms = [(bone_head("upperarm01." + sd_), bone_head("wrist." + sd_)) for sd_ in ("L", "R")]
            mid_y = (bone_head("spine03").y + bone_head("spine01").y) / 2
            neck_z = bone_head("neck01").z
            vest = {}
            for poly in obj.data.polygons:
                c = obj.matrix_world @ poly.center
                sleeve = False
                for a_, b_ in arms:
                    q_, t_ = intersect_point_line(c, a_, b_)
                    if -0.08 < t_ < 1.1 and (c - q_).length < 0.11:
                        sleeve = True
                torso = not sleeve and c.z < neck_z - 0.03
                opening = c.y < mid_y and abs(c.x) < 0.035 + max(0.0, c.z - (neck_z - 0.15)) * 0.55
                vest[poly.index] = 1.0 if torso and not opening else 0.0
            m_ = blur(raster_faces(obj, vest, H, W), 1)
            ms_ = blur(raster_faces(obj, {k: 1.0 - v for k, v in vest.items()}, H, W), 1)
            a_v = tint(arr.copy(), enc(color["vest"]), keep=0.1, region=m_)
            a_s = tint(arr.copy(), enc(color["shirt"]), keep=0.1, region=ms_)
            arr[..., :3] = a_v[..., :3] * m_[..., None] + a_s[..., :3] * (1 - m_[..., None])
            color = None
        elif isinstance(color, dict):
            H, W = arr.shape[:2]
            # each half tinted against its own pixels only (not the empty background)
            tops = island_tops(obj, WAIST_Z)
            top = blur(raster_faces(obj, tops, H, W), 1)
            bot = blur(raster_faces(obj, {k: 1.0 - v for k, v in tops.items()}, H, W), 1)
            a_top = tint(arr.copy(), enc(color["top"]), keep=0.15, region=top)
            a_bot = tint(arr.copy(), enc(color["bottom"]), keep=0.15, region=bot)
            wt = np.where(top + bot > 1e-3, top / np.maximum(top + bot, 1e-3), 1.0)[..., None]
            arr[..., :3] = a_top[..., :3] * wt + a_bot[..., :3] * (1 - wt)
            color = None
        elif color is not None:
            arr = tint(arr, enc(color), keep=0.0 if kind != "clothes" else 0.15)
        img = save_image(img0, arr, base)
    if isinstance(color, dict):
        color = color["top"]
    color = lin(color) if color is not None else None
    roughness = {"eyes": 0.1, "teeth": 0.35, "hair": 0.55}.get(kind, 0.8)
    mat = principled(f"{kind}_{base}", img, color=color, alpha=alpha, roughness=roughness)
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for m in list(obj.modifiers):
        if m.type not in ("ARMATURE",):
            obj.modifiers.remove(m)
    obj.name = f"{kind}_{base}"
    print("part", obj.name, len(obj.data.vertices), "verts", "tex" if img else "flat")


# ======================= accessories on the head bone =======================
def rigid_on(obj, bone="head"):
    obj.parent = rig
    g = obj.vertex_groups.new(name=bone)
    g.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    m = obj.modifiers.new("Armature", "ARMATURE")
    m.object = rig
    for p in obj.data.polygons:
        p.use_smooth = True


def mesh_obj(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat)
    return ob


def head_front_at(z, x=0.0, tol=0.01):
    pts = [v.co for v in head_verts if abs(v.co.x - x) < tol and abs(v.co.z - z) < tol]
    return min(pts, key=lambda c: c.y) if pts else None


def head_side_at(z, y, side):
    pts = [v.co for v in head_verts if abs(v.co.z - z) < 0.012 and abs(v.co.y - y) < 0.015 and v.co.x * side > 0]
    return max(pts, key=lambda c: abs(c.x)) if pts else None


head_ctr = Vector(((min(v.co.x for v in head_verts) + max(v.co.x for v in head_verts)) / 2,
                   (min(v.co.y for v in head_verts) + max(v.co.y for v in head_verts)) / 2, 0))
if P.get("hat"):
    # outback hat: pinched crown, wide brim curling up at the sides
    leather = principled("hat", color=lin(P["hat"]), roughness=0.6)
    band = principled("hat_band", color=lin(0x6b6458), roughness=0.5)
    bm = bmesh.new()
    rings, seg = 9, 40
    crown_r, crown_h = 0.098, 0.1
    vs = []
    for i in range(rings + 1):
        t = i / rings
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            r = crown_r * (1 - 0.18 * t ** 3) * (1 - 0.06 * math.cos(2 * a) * t)
            z = crown_h * t - 0.025 * t ** 4 * (1 + math.cos(a)) * 0.5 - (0.018 * t ** 6 if abs(math.sin(a)) < 0.25 else 0)
            ring.append(bm.verts.new((r * math.sin(a) * 1.0, -r * math.cos(a) * 1.18, z)))
        vs.append(ring)
    top = bm.verts.new((0, 0, crown_h - 0.03))
    for i in range(rings):
        for k in range(seg):
            bm.faces.new((vs[i][k], vs[i][(k + 1) % seg], vs[i + 1][(k + 1) % seg], vs[i + 1][k]))
    for k in range(seg):
        bm.faces.new((vs[rings][k], vs[rings][(k + 1) % seg], top))
    # brim
    brim = []
    for j, (r0, lift) in enumerate([(1.0, 0.0), (1.22, 0.004), (1.45, 0.014), (1.62, 0.034)]):
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            side = abs(math.sin(a))
            z = lift * (0.3 + 1.6 * side ** 2) - 0.012 * (1 - side) * (j / 3)
            ring.append(bm.verts.new((crown_r * r0 * math.sin(a), -crown_r * r0 * 1.18 * math.cos(a), z)))
        brim.append(ring)
    for i in range(3):
        for k in range(seg):
            bm.faces.new((brim[i][k], brim[i + 1][k], brim[i + 1][(k + 1) % seg], brim[i][(k + 1) % seg]))
    hat = mesh_obj("hat", bm, leather)
    sol = hat.modifiers.new("t", "SOLIDIFY")
    sol.thickness = 0.004
    bpy.context.view_layer.objects.active = hat
    bpy.ops.object.modifier_apply(modifier="t")
    # band
    bm = bmesh.new()
    rr = []
    for z in (0.004, 0.026):
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            r = crown_r * 1.012
            ring.append(bm.verts.new((r * math.sin(a), -r * 1.18 * math.cos(a), z)))
        rr.append(ring)
    for k in range(seg):
        bm.faces.new((rr[0][k], rr[0][(k + 1) % seg], rr[1][(k + 1) % seg], rr[1][k]))
    bandob = mesh_obj("hat_band", bm, band)
    # sink the hat until the head (with ~1 cm of hair) fills the crown
    hat_z = HEAD_TOP - 0.062
    for z in [HEAD_TOP - 0.01 * k for k in range(1, 12)]:
        ring = [abs(v.co.x) for v in head_verts if abs(v.co.z - z) < 0.004]
        if ring and max(ring) + 0.01 >= crown_r:
            hat_z = z
            break
    print("hat base", round(HEAD_TOP - hat_z, 3), "below the top")
    for ob in (hat, bandob):
        ob.matrix_world = Matrix.Translation((head_ctr.x, head_ctr.y + 0.005, hat_z)) @ Matrix.Rotation(-0.12, 4, "X")
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        ob.select_set(False)
        rigid_on(ob)

if P.get("sunglasses"):
    # blue mirrored sunglasses pushed up onto the hair: the lenses lie on the
    # front of the hair, the arms run back over it to above the ears
    frame_m = principled("sunglasses_frame", color=lin(0x111111), roughness=0.35)
    lens_m = principled("sunglasses_lens", color=lin(0x2a6bd8), roughness=0.05, metallic=0.9)
    hair_obj = next(o for o in rig.children if o.name.startswith("hair_"))
    pts = [hair_obj.matrix_world @ v.co for v in hair_obj.data.vertices] + [v.co.copy() for v in head_verts]
    hc = Vector((0.0, head_ctr.y, (HEAD_TOP + EYE_Z) / 2))
    d = Vector((0.0, -math.cos(math.radians(52)), math.sin(math.radians(52))))  # forward and up
    X = Vector((1.0, 0.0, 0.0))
    U = d.cross(X).normalized()  # along the scalp toward the back
    P0 = max((q for q in pts if abs(q.x) < 0.015), key=lambda q: (q - hc).dot(d))
    C = P0 + d * 0.005

    def L(x, u, n=0.0):
        return C + X * x + U * u + d * n

    def ring(cx, rx, rz, n):
        return [L(cx + rx * math.copysign(abs(math.cos(a)) ** 0.55, math.cos(a)), rz * math.copysign(abs(math.sin(a)) ** 0.55, math.sin(a)), n)
                for a in [2 * math.pi * k / 20 for k in range(20)]]

    def bar(bm, a, b, r):
        ax = (b - a).normalized()
        p1 = ax.cross(Vector((0, 0, 1)) if abs(ax.z) < 0.9 else Vector((1, 0, 0))).normalized()
        p2 = ax.cross(p1)
        vs = [[bm.verts.new(e + (p1 * math.cos(t) + p2 * math.sin(t)) * r) for t in (0.0, 1.57, 3.14, 4.71)] for e in (a, b)]
        for k in range(4):
            bm.faces.new((vs[0][k], vs[0][(k + 1) % 4], vs[1][(k + 1) % 4], vs[1][k]))

    bm = bmesh.new()
    for sd in (-1, 1):
        bm.faces.new([bm.verts.new(q) for q in ring(sd * 0.033, 0.025, 0.017, 0.0015)])
    lens = mesh_obj("sunglasses_lens", bm, lens_m)
    bm = bmesh.new()
    for sd in (-1, 1):
        r0, r1 = ring(sd * 0.033, 0.027, 0.019, 0.0), ring(sd * 0.033, 0.027, 0.019, 0.004)
        v0, v1 = [bm.verts.new(q) for q in r0], [bm.verts.new(q) for q in r1]
        for k in range(20):
            bm.faces.new((v0[k], v0[(k + 1) % 20], v1[(k + 1) % 20], v1[k]))
        hinge = L(sd * 0.06, 0.004, 0.002)
        zt, yt = EYE_Z + 0.045, head_ctr.y + 0.035
        side = [q for q in pts if abs(q.z - zt) < 0.012 and abs(q.y - yt) < 0.02 and q.x * sd > 0]
        ear = Vector((sd * ((max(abs(q.x) for q in side) if side else 0.08) + 0.004), yt, zt))
        bar(bm, hinge, ear, 0.0022)
    bar(bm, L(-0.007, 0.007, 0.002), L(0.007, 0.007, 0.002), 0.002)
    frame = mesh_obj("sunglasses_frame", bm, frame_m)
    for ob in (lens, frame):
        rigid_on(ob)

if P.get("tufts"):
    # spiky black tufts of hair standing out above and behind the ears
    tuft_m = principled("tufts", color=lin(P["tufts"]["color"]), roughness=0.6)
    bm = bmesh.new()
    rnd = random.Random(5)
    for sd in (-1, 1):
        side = [v.co.copy() for v in head_verts if v.co.x * sd > 0.055 and 0.085 < v.co.y - MOUTH.y < 0.16 and -0.02 < v.co.z - EYE_Z < 0.035]
        if not side:
            continue
        for k in range(42):
            base = rnd.choice(side)
            out = Vector((sd, rnd.uniform(0.3, 1.1), rnd.uniform(-0.35, 0.35))).normalized()
            length, r = rnd.uniform(0.025, 0.048), rnd.uniform(0.009, 0.016)
            p1 = out.cross(Vector((0, 0, 1))).normalized()
            p2 = out.cross(p1)
            ring = [bm.verts.new(base - out * 0.006 + (p1 * math.cos(a) + p2 * math.sin(a) * 0.55) * r)
                    for a in [2 * math.pi * j / 5 for j in range(5)]]
            apex = bm.verts.new(base + out * length)
            for j in range(5):
                bm.faces.new((ring[j], ring[(j + 1) % 5], apex))
    tufts = mesh_obj("tufts", bm, tuft_m)
    rigid_on(tufts)

if P.get("moustache"):
    # a thick black moustache along the upper lip, its ends curling up: drawn
    # as a ribbon in front of the face, pressed onto it, then made thick
    mou_m = principled("moustache", color=lin(P["moustache"]["color"]), roughness=0.55)
    bm = bmesh.new()
    y0 = LIPS.y - 0.06
    for sd in (-1, 1):
        # (sideways, height above the mouth, half width)
        ctrl = [(0.0, 0.017, 0.009), (0.02, 0.015, 0.0105), (0.04, 0.0095, 0.0095), (0.056, 0.006, 0.0075),
                (0.068, 0.0095, 0.0055), (0.075, 0.02, 0.0038), (0.073, 0.031, 0.0025)]
        pts = []
        for i in range(len(ctrl) - 1):
            for t in (0.0, 0.25, 0.5, 0.75):
                pts.append(tuple(ctrl[i][k] * (1 - t) + ctrl[i + 1][k] * t for k in range(3)))
        pts.append(ctrl[-1])
        rows = []
        for i, (lx, up, hw) in enumerate(pts):
            nx_ = pts[min(i + 1, len(pts) - 1)]
            pv_ = pts[max(i - 1, 0)]
            tx, tz = (nx_[0] - pv_[0]) * sd, nx_[1] - pv_[1]
            ln = math.hypot(tx, tz) or 1.0
            nxp, nzp = -tz / ln, tx / ln  # across the ribbon
            cx, cz = sd * lx, MOUTH.z + up
            rows.append((bm.verts.new((cx + nxp * hw, y0, cz + nzp * hw)), bm.verts.new((cx - nxp * hw, y0, cz - nzp * hw))))
        for i in range(len(rows) - 1):
            bm.faces.new((rows[i][0], rows[i + 1][0], rows[i + 1][1], rows[i][1]))
    mou = mesh_obj("moustache", bm, mou_m)
    sw = mou.modifiers.new("onto the face", "SHRINKWRAP")
    sw.target = body
    sw.wrap_method = "PROJECT"
    sw.use_project_y = True
    sw.use_negative_direction = True
    sw.use_positive_direction = True
    sw.offset = 0.003
    so = mou.modifiers.new("thick", "SOLIDIFY")
    so.thickness = 0.011
    so.offset = 0.0
    sub = mou.modifiers.new("soft", "SUBSURF")
    sub.levels = 1
    bpy.context.view_layer.objects.active = mou
    for m in list(mou.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    rigid_on(mou)

if P.get("earrings"):
    metal = principled("earring", color=(0.8, 0.8, 0.82), roughness=0.25, metallic=1.0)
    ear_cfg = P["earrings"] if isinstance(P["earrings"], dict) else dict(side=0, count=1)
    for s in ((-1, 1) if not ear_cfg["side"] else (ear_cfg["side"],)):
        ear = [v.co for v in head_verts if v.co.x * s > 0.055 and 0.07 < v.co.y - MOUTH.y < 0.12
               and abs(v.co.z - (MOUTH.z + 0.018)) < 0.008]
        if not ear:
            continue
        lobe = max(ear, key=lambda c: abs(c.x))
        for k in range(ear_cfg["count"]):  # side by side along the lobe
            bpy.ops.mesh.primitive_torus_add(major_radius=0.0065, minor_radius=0.0013, major_segments=16, minor_segments=6,
                                             location=(lobe.x + s * 0.002, lobe.y + k * 0.006, lobe.z - 0.006 + k * 0.004),
                                             rotation=(0, math.pi / 2, 0))
            ring = bpy.context.active_object
            ring.name = "earring"
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            ring.data.materials.append(metal)
            rigid_on(ring)

if P.get("chain"):
    # a heavy curb chain: links round the neck, dropping in a V onto the chest,
    # laid just outside the shirt / skin
    metal = principled("chain", color=lin(P["chain"]), roughness=0.22, metallic=1.0)
    surf = [o.matrix_world @ v.co for o in rig.children if o.type == "MESH" and (o is body or o.name.startswith("clothes_"))
            and "beard" not in o.name for v in o.data.vertices]
    n0 = bone_head("neck01")
    ctr = Vector((n0.x, n0.y + 0.005, 0))
    base_z = n0.z - 0.035
    bm = bmesh.new()
    links = 96
    pts = []
    for k in range(links + 1):
        a = 2 * math.pi * k / links
        z = base_z - 0.1 * ((1 + math.cos(a)) / 2) ** 2.5  # the front hangs lowest
        dirh = Vector((math.sin(a), -math.cos(a), 0))
        # the neck, or the chest where the front hangs - never out on the shoulders
        lim = 0.1 + 0.04 * ((1 + math.cos(a)) / 2)
        near = [(q - ctr).to_2d().length for q in surf
                if abs(q.z - z) < 0.01 and (q - ctr).to_2d().length < lim
                and (q - ctr).to_2d().normalized().dot(dirh.to_2d()) > 0.985]
        r = (max(near) if near else 0.065) + 0.005
        pts.append(ctr + dirh * r + Vector((0, 0, z)))
    for k in range(links):
        c = (pts[k] + pts[k + 1]) / 2
        t = (pts[k + 1] - pts[k]).normalized()
        nrm = (c - Vector((ctr.x, ctr.y, c.z))).normalized()
        if k % 2:
            nrm = t.cross(nrm).normalized()
        b2 = t.cross(nrm).normalized()
        ring = []
        for i in range(8):
            ph = 2 * math.pi * i / 8
            ce = c + (t * math.cos(ph) * 0.0062 + nrm * math.sin(ph) * 0.0042)
            rad = (t * math.cos(ph) + nrm * math.sin(ph)).normalized()
            ring.append([bm.verts.new(ce + (rad * math.cos(q) + b2 * math.sin(q)) * 0.0016)
                         for q in [2 * math.pi * j / 4 for j in range(4)]])
        for i in range(8):
            for j in range(4):
                bm.faces.new((ring[i][j], ring[(i + 1) % 8][j], ring[(i + 1) % 8][(j + 1) % 4], ring[i][(j + 1) % 4]))
    chain = mesh_obj("chain", bm, metal)
    rigid_on(chain, "spine01")

# ======================= export =============================================
lips_gltf = [LIPS.x, LIPS.z, -LIPS.y]
rig["mouth"] = lips_gltf
for o in bpy.context.scene.objects:
    if o.type == "MESH" and o.parent is not rig:
        o.hide_set(True)
bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True)
for o in rig.children:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, use_selection=True, export_format="GLB", export_skins=True, export_morph=True,
                          export_morph_normal=False, export_animations=False, export_extras=True, export_yup=True,
                          export_apply=False, export_image_format="WEBP", export_materials="EXPORT")
print("EXPORTED", OUT)
