import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createStudioApp } from './app'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const dataDir = process.env.YZ_DATA_DIR ?? join(homedir(), 'Library', 'Application Support', 'YueZhuangStudio')
const port = Number(process.env.YZ_SERVER_PORT ?? 5189)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('YZ_SERVER_PORT 必须为有效端口。')
process.umask(0o077)
const runtime = createStudioApp({ dataDir, publicDir: join(root, 'public'), ...(process.env.NODE_ENV === 'production' ? { distDir: join(root, 'dist') } : {}) })
const server = runtime.app.listen(port, '127.0.0.1', () => {
  runtime.jobs.recover()
  console.log(`悦妆师本地服务：http://127.0.0.1:${port}`)
})
server.on('error', () => { console.error(`本地服务无法监听端口 ${port}，请检查是否已启动。`); process.exitCode = 1; runtime.database.close() })
function stop() { server.close(() => { runtime.database.close(); process.exit(0) }); setTimeout(() => process.exit(0), 5000).unref() }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
