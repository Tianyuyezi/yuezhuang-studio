import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Keychain } from '../server/security/keychain'
import { allowedRequest, publicOrigin } from '../server/security/request-origin'
import { createWorkspaceApp as createStudioApp } from '../server/workspace-app'

const directories: string[] = []
function temporary() { const dir = mkdtempSync(join(tmpdir(), 'yz-deploy-')); directories.push(dir); return dir }
afterEach(() => { directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })) })

describe('server deployment', () => {
  it('allows only the configured HTTPS origin and retains local development access', () => {
    const origin = publicOrigin('https://ins-fb.tianyuyezi.com/')!
    expect(allowedRequest('ins-fb.tianyuyezi.com', origin, 'ins-fb.tianyuyezi.com', origin)).toBeNull()
    expect(allowedRequest('ins-fb.tianyuyezi.com', 'https://evil.invalid', 'ins-fb.tianyuyezi.com', origin)).toBe('ORIGIN_REJECTED')
    expect(allowedRequest('ins-fb.tianyuyezi.com.evil.invalid', undefined, undefined, origin)).toBe('HOST_REJECTED')
    expect(allowedRequest('ins-fb.tianyuyezi.com', 'http://ins-fb.tianyuyezi.com', 'ins-fb.tianyuyezi.com', origin)).toBe('ORIGIN_REJECTED')
    expect(allowedRequest('ins-fb.tianyuyezi.com', undefined, undefined)).toBe('HOST_REJECTED')
    expect(allowedRequest('127.0.0.1', 'http://localhost:5188', '127.0.0.1:5189')).toBeNull()
    expect(() => publicOrigin('http://ins-fb.tianyuyezi.com')).toThrow()
    expect(() => publicOrigin('https://ins-fb.tianyuyezi.com/path')).toThrow()
  })
  it('serves sessions with secure cookies behind the configured domain and rejects foreign origins', async () => {
    const runtime = createStudioApp({ dataDir: temporary(), publicDir: 'public', publicOrigin: 'https://ins-fb.tianyuyezi.com' })
    const server = runtime.app.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => server.once('listening', resolve))
    try {
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
      const headers = { Host: 'ins-fb.tianyuyezi.com', Origin: 'https://ins-fb.tianyuyezi.com' }
      const session = await fetch(base + '/api/session', { headers })
      expect(session.status).toBe(200)
      expect(session.headers.get('set-cookie')).toContain('; Secure')
      const cookie = session.headers.get('set-cookie')!.split(';')[0]
      const { csrf } = await session.json()
      const snapshot = runtime.database.snapshot()
      const saved = await fetch(base + '/api/workspace', { method: 'PUT', headers: { ...headers, Cookie: cookie, 'X-YZ-CSRF': csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: snapshot.revision, state: snapshot.state }) })
      expect(saved.status).toBe(200)
      expect((await fetch(base + '/api/session', { headers: { ...headers, Origin: 'https://evil.invalid' } })).status).toBe(403)
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); runtime.database.close() }
  })
  it('persists encrypted credentials across restarts, isolates namespaces and removes credentials', async () => {
    const dir = temporary()
    const secret = 'test-secret-never-plaintext-1234'
    const keys = new Keychain('AI', dir)
    await keys.set('https://provider.invalid', secret)
    expect(await new Keychain('AI', dir).get('https://provider.invalid')).toBe(secret)
    expect(await new Keychain('Instagram', dir).get('https://provider.invalid')).toBeNull()
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    for (const name of readdirSync(dir)) {
      expect(readFileSync(join(dir, name)).includes(Buffer.from(secret))).toBe(false)
      expect(statSync(join(dir, name)).mode & 0o777).toBe(0o600)
    }
    await new Keychain('AI', dir).remove('https://provider.invalid')
    expect(await new Keychain('AI', dir).get('https://provider.invalid')).toBeNull()
  })
  it('reports damaged encrypted credentials rather than silently dropping them', async () => {
    const dir = temporary()
    await new Keychain('AI', dir).set('https://provider.invalid', 'test-secret-1234')
    writeFileSync(join(dir, readdirSync(dir).find((name) => name.endsWith('.enc'))!), Buffer.alloc(30))
    await expect(new Keychain('AI', dir).get('https://provider.invalid')).rejects.toThrow('无法解密')
  })
})
