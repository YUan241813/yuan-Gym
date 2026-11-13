import { spawnSync } from 'node:child_process'

// Force the working directory to the frontend project root. Many test files
// read source CSS / API routes via resolve(process.cwd(), 'src/...'), so the
// suite MUST run with cwd === this directory, not the WorkBuddy session dir.
const root = 'D:/Self-developedSoftware/yuan-Gym/app/frontend'

const args = [
  'node_modules/vitest/vitest.mjs',
  'run',
  '--root', root,
  ...process.argv.slice(2),
]

const r = spawnSync(process.execPath, args, {
  stdio: 'inherit',
  cwd: root,
  env: process.env,
})

process.exit(r.status ?? 1)
