const fs = require('fs');
const path = require('path');
const B = 'D:\\Self-developedSoftware\\yuan-Gym\\app\\frontend\\android\\app\\build\\intermediates';
const targets = [
  'assets\\sideloadRelease',
  'compressed_assets\\sideloadRelease',
  'merged_assets\\sideloadRelease',
  'packaged_manifests\\sideloadRelease',
];
for (const t of targets) {
  const p = path.join(B, t);
  const t0 = Date.now();
  try {
    if (!fs.existsSync(p)) { console.log('skip absent: ' + t); continue; }
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 2 });
    console.log('DELETED ' + t + ' in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  } catch (e) {
    console.log('FAIL ' + t + ' -> ' + e.message);
  }
}
console.log('--- now ---');
for (const d of ['assets', 'compressed_assets']) {
  try {
    const list = fs.readdirSync(path.join(B, d));
    console.log(d + ': ' + list.join(', '));
  } catch (e) { console.log(d + ': (none)'); }
}
