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
    # the owner: broad friendly face, short dark hair with volume on top,
    # short full beard, thick straight brows, blue mirrored sunglasses
    # pushed up on his head; black puffer jacket, olive trousers, boots
    "owner": dict(
        phenotype=dict(gender=1.0, age=0.54, muscle=0.6, weight=0.58, proportions=0.6, height=0.55,
                       race=dict(caucasian=0.82, asian=0.06, african=0.12)),
        targets={"head-square": 0.3, "head-round": 0.25, "head-fat-incr": 0.45, "head-scale-horiz-incr": 0.18,
                 "head-scale-vert-decr": 0.15, "chin-height-decr": 0.2, "chin-width-incr": 0.35, "neck-scale-horiz-incr": 0.2,
                 "chin-prominent-incr": 0.2, "nose-scale-horiz-incr": 0.2, "nose-volume-incr": 0.25,
                 "nose-point-width-incr": 0.3, "eyebrows-trans-down": 0.25, "mouth-scale-horiz-incr": 0.1,
                 "l-cheek-volume-incr": 0.3, "r-cheek-volume-incr": 0.3, "l-eye-scale-decr": 0.1, "r-eye-scale-decr": 0.1},
        skin=0xd3a487, eyes="brownlight", hair_color=0x231811,
        eyebrows="eyebrow009", hair="culturalibre_hair_02",
        beard=dict(color=0x26170e, density=0.95, cheek=0.5, neck=0.6, stubble=0.35),
        clothes=[("male_casualsuit05", dict(top=0x17181b, bottom=0x434832)), ("shoes03", 0x1d1b19)],
        sunglasses=True,
    ),
    # Amir Esmaeil: tall, long face, strong nose with a hump, heavy brows,
    # dark hair pulled back, thick full beard; brown jacket, grey jeans
    "amir": dict(
        phenotype=dict(gender=1.0, age=0.58, muscle=0.55, weight=0.55, proportions=0.65, height=0.6,
                       race=dict(caucasian=0.74, asian=0.06, african=0.2)),
        targets={"head-oval": 0.45, "head-scale-vert-incr": 0.2, "head-scale-horiz-decr": 0.08, "nose-hump-incr": 0.55,
                 "nose-scale-vert-incr": 0.3, "nose-scale-depth-incr": 0.25, "nose-point-down": 0.2,
                 "eyebrows-trans-down": 0.35, "eyebrows-trans-forward": 0.3, "l-eye-push1-in": 0.2, "r-eye-push1-in": 0.2,
                 "chin-height-incr": 0.2, "l-cheek-bones-incr": 0.3, "r-cheek-bones-incr": 0.3},
        skin=0xc6997c, eyes="brown", hair_color=0x15100d,
        eyebrows="eyebrow009", hair="rehmanpolanski_hair_bun_brown",
        beard=dict(color=0x15100d, density=1.0, cheek=0.62, neck=1.0, stubble=0.15, mesh="wdg_scruffy_beard"),
        clothes=[("male_casualsuit01", dict(top=0x6e4528, bottom=0x4d5054)), ("toigo_ankle_boots_male", 0xc08a48)],
    ),
    # Amin: big laugh, long face, prominent nose, defined cheekbones, full
    # trimmed black beard with a thick mustache, leather outback hat, small
    # silver hoops; charcoal coat over a grey knit
    "amin": dict(
        phenotype=dict(gender=1.0, age=0.56, muscle=0.55, weight=0.48, proportions=0.6, height=0.56,
                       race=dict(caucasian=0.78, asian=0.04, african=0.18)),
        targets={"head-oval": 0.3, "head-scale-vert-incr": 0.15, "nose-scale-vert-incr": 0.25, "nose-hump-incr": 0.3,
                 "nose-scale-depth-incr": 0.2, "nose-point-width-incr": 0.2, "l-cheek-bones-incr": 0.5,
                 "r-cheek-bones-incr": 0.5, "l-cheek-volume-decr": 0.25, "r-cheek-volume-decr": 0.25,
                 "eyebrows-trans-down": 0.2, "chin-prominent-incr": 0.2, "mouth-scale-horiz-incr": 0.15},
        skin=0xcc9b7e, eyes="brown", hair_color=0x110b09,
        eyebrows="eyebrow012", hair="short01",
        beard=dict(color=0x110b09, density=1.0, cheek=0.55, neck=0.85, stubble=0.1),
        clothes=[("toigo_fisherman_sweater", 0x3a3b40), ("toigo_wool_pants", 0x2b2723), ("shoes03", 0x3b2819)],
        hat=0x5b3b22, earrings=True, smile=1.0,
    ),
    # Alireza (Ali): tall, young, rounder face with full cheeks, brown hair
    # swept up, light stubble beard and mustache; olive hooded parka, dark jeans
    "alireza": dict(
        phenotype=dict(gender=1.0, age=0.5, muscle=0.5, weight=0.62, proportions=0.6, height=0.56,
                       race=dict(caucasian=0.88, asian=0.04, african=0.08)),
        targets={"head-round": 0.5, "head-fat-incr": 0.35, "head-scale-vert-decr": 0.15, "chin-height-decr": 0.15, "l-cheek-volume-incr": 0.5, "r-cheek-volume-incr": 0.5,
                 "nose-scale-horiz-incr": 0.15, "nose-volume-incr": 0.2, "chin-width-incr": 0.2,
                 "l-eye-height2-decr": 0.15, "r-eye-height2-decr": 0.15, "eyebrows-trans-up": 0.1},
        skin=0xdcae8f, eyes="brown", hair_color=0x5b3f2b,
        eyebrows="eyebrow001", hair="culturalibre_hair_05",
        beard=dict(color=0x4a3322, density=0.22, cheek=0.4, neck=0.45, stubble=0.55),
        clothes=[("male_casualsuit02", dict(top=0x3e4229, bottom=0x24272d)), ("shoes02", 0x5a4632)],
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
info["hair"] = P["hair"] + ".mhclo"
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
    detail = (lum / mlum)[..., None]
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
    top = 0.021 + t * eye_h * (0.3 + 0.9 * b["cheek"]) + smooth(0.0, 0.03, lx) * 0.004
    w = 1.0 - smooth(top - 0.005, top + 0.005, up)
    # stop at the front of the ear
    w *= 1.0 - smooth(0.085, 0.1, back)
    # under the chin down onto the neck
    low = CHIN_Z - MOUTH.z - 0.015 - 0.035 * b["neck"]
    w *= smooth(low - 0.012, low + 0.004, up)
    # bare lips
    lip = (co.x / 0.025) ** 2 + (up / 0.0092) ** 2
    if lip < 1.0 and back < 0.03:
        w *= smooth(0.55, 1.0, lip)
    return max(0.0, min(1.0, w))


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


def blur(mask, r):
    from numpy.lib.stride_tricks import sliding_window_view as swv
    pad = np.pad(mask, r, mode="edge")
    return swv(pad, (2 * r + 1, 2 * r + 1)).mean(axis=(2, 3))


b = P["beard"]
if b["density"] > 0:
    H, W = skin.shape[:2]
    vw = {}
    for v in body.data.vertices:
        if abs(v.co.z - MOUTH.z) < 0.16 and -(v.co.y - MOUTH.y) > -0.13:
            vw[v.index] = beard_weight(v.co)
    mask = blur(raster(body, vw, H, W), 3)
    rng = np.random.default_rng(7)
    grain = rng.random((H, W)).astype(np.float32)
    streak = sum(np.roll(grain, k, axis=1) for k in range(5)) / 5  # short hairs along the growth direction
    hairs = np.clip((streak - 0.3) * 2.0, 0, 1)
    cover = mask * (b["density"] * (0.55 + 0.45 * hairs) + b["stubble"] * 0.25)
    cover = np.clip(cover, 0, 0.96)[..., None]
    col = enc(b["color"])[None, None, :]
    skin[..., :3] = skin[..., :3] * (1 - cover) + col * cover
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
WAIST_Z = rig.data.bones["upperleg01.L"].head_local.z + 0.1
for obj in list(rig.children):
    if obj is body or obj.type != "MESH":
        continue
    kind = kind_of(obj)
    info_m = parse_mhmat(mhmat_for(obj))
    src = str(GeneralObjectProperties.get_value("asset_source", entity_reference=obj) or obj.name)
    base = os.path.splitext(os.path.basename(src))[0]
    tex = info_m.get("diffuseTexture")
    if kind == "eyes":
        tex = os.path.join(LocationService.get_user_data(), "eyes", "materials", P["eyes"] + "_eye.png")
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
        if isinstance(color, dict):
            H, W = arr.shape[:2]
            top = blur(raster(obj, {v.index: 1.0 if v.co.z > WAIST_Z else 0.0 for v in obj.data.vertices}, H, W), 1)
            a_top = tint(arr.copy(), enc(color["top"]), keep=0.15, region=top)
            a_bot = tint(arr.copy(), enc(color["bottom"]), keep=0.15, region=1 - top)
            arr[..., :3] = a_top[..., :3] * top[..., None] + a_bot[..., :3] * (1 - top[..., None])
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
    for ob in (hat, bandob):
        ob.matrix_world = Matrix.Translation((head_ctr.x, head_ctr.y + 0.005, HEAD_TOP - 0.062)) @ Matrix.Rotation(-0.12, 4, "X")
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

if P.get("earrings"):
    metal = principled("earring", color=(0.8, 0.8, 0.82), roughness=0.25, metallic=1.0)
    for s in (-1, 1):
        ear = [v.co for v in head_verts if v.co.x * s > 0.062 and -0.13 < -(v.co.y - MOUTH.y) < -0.055 and MOUTH.z - 0.01 < v.co.z < EYE_Z]
        if not ear:
            continue
        lobe = min(ear, key=lambda c: c.z)
        bpy.ops.mesh.primitive_torus_add(major_radius=0.0075, minor_radius=0.0013, major_segments=16, minor_segments=6,
                                         location=(lobe.x + s * 0.002, lobe.y, lobe.z - 0.007), rotation=(0, math.pi / 2, 0))
        ring = bpy.context.active_object
        ring.name = "earring"
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        ring.data.materials.append(metal)
        rigid_on(ring)

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
