const fs = require('fs');
const path = require('path');
const B = 'D:\\Self-developedSoftware\\yuan-Gym\\app\\frontend\\android\\app\\build\\intermediates';
const targets = [
  'compressed_assets\\sideloadRelease',
  'compressed_assets\\fdroidDebug',
  'compressed_assets\\playDebug',
  'assets\\sideloadRelease',
  'assets\\fdroidDebug',
  'assets\\playDebug',
];
for (const t of targets) {
  const p = path.join(B, t);
  const t0 = Date.now();
  try {
    if (!fs.existsSync(p)) { console.log('skip (absent): ' + t); continue; }
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 });
    console.log('OK   deleted: ' + t + '  (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
  } catch (e) {
    console.log('FAIL ' + t + ' -> ' + e.message);
  }
}
console.log('--- remaining ---');
try {
  for (const d of fs.readdirSync(path.join(B, 'compressed_assets'))) console.log('compressed_assets/' + d);
} catch (e) { console.log('(none)'); }
try {
  for (const d of fs.readdirSync(path.join(B, 'assets'))) console.log('assets/' + d);
} catch (e) { console.log('(none)'); }
