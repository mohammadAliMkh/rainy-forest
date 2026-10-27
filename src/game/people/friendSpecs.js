// The four friends around the fire, described for the procedural Human
// builder (face proportions, hair, beard, skin, clothes, accessories).
// Modelled after reference photos the owner shared; the photos themselves
// are not part of the project.

export const FRIENDS = {
  // Amir Esmaeil: tall, long dark wavy hair pulled back, full beard, brown
  // suede jacket with a dark shearling collar, grey jeans, tan Chelsea boots,
  // silver rings. The Patrol is his.
  amir: {
    name: 'امیر اسماعیل',
    seed: 11,
    height: 1.04, build: 1.04, shoulders: 1.05,
    skin: 0xc6997c,
    eyeColor: 0x24160c,
    hairColor: 0x15100d,
    face: { width: 0.97, length: 1.08, jaw: 0.55, nose: 1.18, noseWidth: 1.0, hump: 0.7, brow: 1.15, cheek: 0.8, lips: 0.9, chin: 0.9 },
    hair: { front: 0.46, recede: 0.06, sidesLine: 0.0, nape: -0.6, thick: 0.011, backVolume: 0.012, highlight: 0x3a2a20, long: { count: 34, length: 0.28, radius: 0.015, curls: 3, wave: 0.02 } },
    beard: { style: 'full', thick: 0.017, cheekTop: -0.04, mustache: 1.3, color: 0x15100d, highlight: 0x34261c },
    brows: { thick: 0.003, width: 0.05 },
    rings: true,
    hold: 'right',
    outfit: {
      jacket: { color: 0x6e4528, tex: 'suede', open: true, collar: 'shearling', collarColor: 0x3b3524, sleeve: 0.056, pad: 0.016 },
      inner: { color: 0x0f0f10 },
      pants: { color: 0x4d5054, tex: 'denim' },
      shoes: { style: 'chelsea', color: 0xc08a48, sole: 0x4a3420 },
    },
  },
  // The owner: short thin dark hair receding at the temples, sandy mustache
  // and short beard, green-hazel eyes, a slight smile, black watch, black
  // puffer jacket, olive trousers. Luna lies beside him.
  owner: {
    name: '',
    seed: 22,
    height: 1.0, build: 1.05, shoulders: 1.04,
    skin: 0xd3a487,
    eyeColor: 0x6b6a3a,
    hairColor: 0x2a1c14,
    face: { width: 1.03, length: 1.0, jaw: 0.68, nose: 1.0, noseWidth: 1.06, brow: 1.0, cheek: 1.05, lips: 1.0, chin: 1.05, smile: 0.35 },
    hair: { front: 0.56, recede: 0.13, sidesLine: 0.08, nape: -0.5, thick: 0.009, sides: 0.5, rough: 0.3 },
    beard: { style: 'short', thick: 0.0055, cheekTop: -0.2, cheeks: 0.5, mustache: 1.0, color: 0x3b2618, highlight: 0x5e3c24, stubble: 0.4, density: 0.9 },
    brows: { thick: 0.0032, width: 0.052 },
    watch: 'left',
    hold: 'right',
    outfit: {
      jacket: { color: 0x17181b, tex: 'fabric', quilted: true, zip: true, collar: 'stand', roughness: 0.45, sleeve: 0.06, pad: 0.022 },
      pants: { color: 0x434832, tex: 'fabric' },
      shoes: { style: 'boot', color: 0x1d1b19 },
    },
  },
  // Alireza: fair skin, near-black eyes, thick dark brown hair swept up and
  // back, a light sandy beard and mustache; olive t-shirt, dark jeans.
  alireza: {
    name: 'علیرضا',
    seed: 33,
    height: 0.99, build: 1.08, shoulders: 1.0, belly: 0.015,
    skin: 0xdcae8f,
    eyeColor: 0x3a2617,
    hairColor: 0x3a2618,
    face: { width: 1.05, length: 0.98, jaw: 0.72, nose: 1.05, noseWidth: 1.1, brow: 0.9, cheek: 1.3, lips: 1.0, chin: 0.9, lidOpen: 0.14 },
    hair: { front: 0.5, recede: 0.0, quiff: 0.032, thick: 0.011, sides: 0.35, sidesLine: 0.02, nape: -0.5, highlight: 0x5a3d26, rough: 0.2 },
    beard: { style: 'stubble', thick: 0.0024, cheekTop: -0.16, cheeks: 0.8, mustache: 1.1, color: 0x3b2819, stubble: 0.65, density: 0.7 },
    brows: { thick: 0.0028, width: 0.045 },
    hold: 'right',
    outfit: {
      jacket: { color: 0x3e4229, tex: 'fabric', zip: true, collar: 'hood', sleeve: 0.06, pad: 0.02 },
      pants: { color: 0x24272d, tex: 'denim' },
      shoes: { style: 'sneaker', color: 0x5a4632 },
    },
  },
  // Amin: big laugh, head shaved short under his leather outback hat, thick
  // bushy black beard, heavy brows, two small hoops in one ear, a silver chain
  // and tattoos on his neck, arms and hands; black t-shirt. He has his
  // acoustic guitar on his lap and plays now and then.
  amin: {
    name: 'امین',
    seed: 44,
    height: 1.0, build: 0.98, shoulders: 1.0,
    skin: 0xcc9b7e,
    eyeColor: 0x22150c,
    hairColor: 0x110b09,
    face: { width: 0.98, length: 1.03, jaw: 0.6, nose: 1.1, noseWidth: 1.0, brow: 1.2, cheek: 1.1, lips: 1.0, chin: 1.0, smile: 1, open: 1 },
    hair: { front: 0.55, thick: 0.006, sides: 0.7, sidesLine: 0.0, nape: -0.5 },
    beard: { style: 'full', thick: 0.012, cheekTop: -0.08, mustache: 1.35, color: 0x110b09, highlight: 0x2a1d15 },
    brows: { thick: 0.0036, width: 0.056 },
    hat: { color: 0x5b3b22 },
    earrings: true,
    hold: 'none',
    guitar: true,
    outfit: {
      jacket: { color: 0x2c2c30, tex: 'fabric', open: true, collar: 'turtle', collarColor: 0xa9adb0, collarTex: 'knit', sleeve: 0.054, pad: 0.016 },
      inner: { color: 0x8a9096 }, // a cool grey: stays neutral (not skin-like) in the orange firelight
      pants: { color: 0x2b2723, tex: 'fabric' },
      shoes: { style: 'boot', color: 0x3b2819 },
    },
  },
};
