import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { AppError } from '../errors'
import { CredentialFiles } from './credential-files'

const exec = promisify(execFile)

export class Keychain {
  private cache = new Map<string, string>()
  readonly storage: 'keychain' | 'session' | 'encrypted-file'
  private files?: CredentialFiles
  constructor(private namespace = 'YueZhuangStudio', credentialDir?: string) {
    this.storage = credentialDir ? 'encrypted-file' : process.platform === 'darwin' ? 'keychain' : 'session'
    if (credentialDir) this.files = new CredentialFiles(credentialDir)
  }
  private name(baseUrl: string) { return `${this.namespace}.ai.${createHash('sha256').update(baseUrl.replace(/\/$/, '')).digest('hex').slice(0, 24)}` }
  async get(baseUrl: string): Promise<string | null> {
    const name = this.name(baseUrl)
    if (this.cache.has(name)) return this.cache.get(name)!
    if (this.files) return this.files.get(name)
    if (this.storage === 'session') return null
    try {
      const result = await exec('/usr/bin/security', ['find-generic-password', '-s', name, '-a', 'default', '-w'], { timeout: 10000, maxBuffer: 16384 })
      const key = result.stdout.trim()
      if (key) this.cache.set(name, key)
      return key || null
    } catch (error) {
      if ((error as { code?: number }).code === 44) return null
      throw new AppError('KEYCHAIN_LOCKED', '无法读取系统钥匙串，请解锁登录钥匙串后重试。', 503)
    }
  }
  async set(baseUrl: string, key: string) {
    if (!/^[A-Za-z0-9._~+/=-]{10,8192}$/.test(key)) throw new AppError('INVALID_KEY', '密钥格式无效，请重新粘贴。')
    const name = this.name(baseUrl)
    if (this.files) this.files.set(name, key)
    if (this.storage === 'keychain') await new Promise<void>((resolve, reject) => {
      // Interactive stdin keeps the credential out of command arguments and process listings.
      const child = spawn('/usr/bin/security', ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] })
      const timer = setTimeout(() => { child.kill(); reject(new AppError('KEYCHAIN_TIMEOUT', '保存钥匙串超时，请检查系统提示。', 503)) }, 10000)
      child.stderr.resume()
      child.on('error', () => { clearTimeout(timer); reject(new AppError('KEYCHAIN_ERROR', '无法保存系统钥匙串。', 503)) })
      child.on('close', (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new AppError('KEYCHAIN_ERROR', '系统钥匙串拒绝保存凭据。', 503)) })
      child.stdin.end(`add-generic-password -U -s "${name}" -a "default" -w "${key}"\n`)
    })
    this.cache.set(name, key)
  }
  async remove(baseUrl: string) {
    const name = this.name(baseUrl)
    if (this.files) this.files.remove(name)
    if (this.storage === 'keychain') {
      try { await exec('/usr/bin/security', ['delete-generic-password', '-s', name, '-a', 'default'], { timeout: 10000 }) }
      catch (error) { if ((error as { code?: number }).code !== 44) throw new AppError('KEYCHAIN_ERROR', '无法移除系统钥匙串凭据。', 503) }
    }
    this.cache.delete(name)
  }
}
