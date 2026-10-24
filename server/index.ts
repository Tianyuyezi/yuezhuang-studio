import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createStudioApp } from './app'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const dataDir = process.env.YZ_DATA_DIR ?? join(homedir(), 'Library', 'Application Support', 'YueZhuangStudio')
const port = Number(process.env.YZ_SERVER_PORT ?? 5189)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('YZ_SERVER_PORT 必须为有效端口。')
process.umask(0o077)
const runtime = createStudioApp({ dataDir, publicDir: join(root, 'public'), publicOrigin: process.env.YZ_PUBLIC_ORIGIN, credentialDir: process.env.YZ_CREDENTIAL_DIR, ...(process.env.NODE_ENV === 'production' ? { distDir: join(root, 'dist') } : {}) })
const instagramPort = Number(process.env.YZ_INSTAGRAM_PORT ?? 5191)
if (!Number.isInteger(instagramPort) || instagramPort < 1024 || instagramPort > 65535 || instagramPort === port) throw new Error('YZ_INSTAGRAM_PORT 必须为独立有效端口。')
const mediaServer = runtime.instagramPublicApp.listen(instagramPort, '127.0.0.1')
mediaServer.on('error', () => { runtime.stopPublishing(); console.error(`Instagram 图片服务无法监听端口 ${instagramPort}。请检查端口后重启，发布暂不可用。`); process.exitCode = 1 })
const server = runtime.app.listen(port, '127.0.0.1', () => {
  runtime.start()
  console.log(`悦妆师本地服务：http://127.0.0.1:${port}`)
})
server.on('error', () => { runtime.stopPublishing(); mediaServer.close(); console.error(`本地服务无法监听端口 ${port}，请检查是否已启动。`); process.exitCode = 1; runtime.close() })
function stop() { runtime.stopPublishing(); mediaServer.close(); server.close(() => { runtime.close(); process.exit(0) }); setTimeout(() => process.exit(0), 5000).unref() }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
