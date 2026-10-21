// Guess a starting quality tier from the GPU the browser is actually using
// (on laptops with two GPUs this is whichever one the browser runs on).
// The in-game governor then refines it from the measured frame rate.

export const TIERS = ['low', 'medium', 'high', 'ultra'];

export function detectGpu(renderer) {
  let name = '';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch { /* hidden by the browser */ }
  const n = name.toLowerCase();
  const ua = navigator.userAgent || '';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  let tier = 'medium';
  if (/swiftshader|llvmpipe|softpipe|software|basic render/.test(n)) tier = 'low';
  else if (mobile) tier = /apple gpu|adreno.*(7[3-9]\d|[89]\d\d)|immortalis|mali-g(7[1-9]|[6-9]\d\d)/.test(n) ? 'medium' : 'low';
  else if (/rtx|radeon rx [6-9]\d{3}|radeon pro w|arc a7|apple m\d (pro|max|ultra)/.test(n)) tier = 'ultra';
  else if (/gtx|geforce|quadro|radeon rx|radeon r9|radeon pro|apple m\d|apple gpu|intel.*arc/.test(n)) tier = 'high';
  else if (/hd graphics( [2-5]\d{3})?\b(?! 6)/.test(n) && !/uhd|iris/.test(n)) tier = 'low';
  return { name, tier, mobile };
}
