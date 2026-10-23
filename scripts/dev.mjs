import { spawn } from 'node:child_process'

const children = [
  spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'watch', 'server/index.ts'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], { stdio: 'inherit' }),
]
let closing = false
function stop(code = 0) { if (closing) return; closing = true; for (const child of children) child.kill('SIGTERM'); process.exitCode = code }
for (const child of children) child.on('exit', (code) => stop(code ?? 0))
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
