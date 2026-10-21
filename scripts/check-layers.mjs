// Fails if any file imports from a layer above its own (see ARCHITECTURE.md).
// Runs with `npm run typecheck` (and so before every build).
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve('src');
// which layers each layer may use
const ALLOWED = {
  config: ['config'],
  utils: ['utils'],
  engine: ['engine', 'config', 'utils'],
  game: ['game', 'engine', 'config', 'utils'],
  ui: ['ui', 'engine', 'config', 'utils'],
  app: ['app', 'game', 'ui', 'engine', 'config', 'utils'],
};
const layerOf = (file) => {
  const rel = path.relative(SRC, file).split(path.sep);
  return rel.length > 1 ? rel[0] : 'app'; // main.ts sits at the top, like app/
};

const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|ts)$/.test(e.name)) files.push(p);
  }
};
walk(SRC);

// static imports / re-exports, and import('...') in types or JSDoc
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm;
const problems = [];
for (const file of files) {
  const layer = layerOf(file);
  if (!ALLOWED[layer]) { problems.push(`${path.relative('.', file)}: unknown layer "${layer}" (add it to scripts/check-layers.mjs)`); continue; }
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(SPEC)) {
    const target = path.resolve(path.dirname(file), m[1]);
    if (!target.startsWith(SRC + path.sep)) continue;
    const to = layerOf(target);
    if (!ALLOWED[layer].includes(to)) problems.push(`${path.relative('.', file)} (${layer}) imports ${m[1]} (${to})`);
  }
}
if (problems.length) {
  console.error('Layer rule broken - a layer may only use the layers below it:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`layers ok (${files.length} files)`);
