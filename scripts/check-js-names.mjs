// The older .js files aren't type-checked yet (too many loose types), but
// a name that doesn't exist is always a bug: run the checker over them and
// fail only on "cannot find name" / "used before declaration" errors.
// Runs with `npm run typecheck` (and so before every build).
import { spawnSync } from 'node:child_process';

const res = spawnSync('npx', ['tsc', '--noEmit', '--checkJs', '--pretty', 'false'], { encoding: 'utf8', shell: process.platform === 'win32' });
const fatal = (res.stdout || '').split('\n').filter((l) => /\.js\(\d+,\d+\): error TS(2304|2552|2662|2663|2448|2454):/.test(l));
if (fatal.length) {
  console.error('Undefined names in .js files:\n  ' + fatal.join('\n  '));
  process.exit(1);
}
console.log('js names ok');
