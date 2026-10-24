import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AppError } from '../errors'

// This directory is private to the service user and must be backed up separately.
export class CredentialFiles {
  private key: Buffer
  constructor(private directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    chmodSync(directory, 0o700)
    const path = join(directory, 'master.key')
    try { writeFileSync(path, randomBytes(32), { flag: 'wx', mode: 0o600 }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    chmodSync(path, 0o600)
    this.key = readFileSync(path)
    if (this.key.length !== 32) throw new AppError('CREDENTIAL_STORE', '服务器凭据存储密钥无效。', 503)
  }
  private path(name: string) { return join(this.directory, `${createHash('sha256').update(name).digest('hex')}.enc`) }
  get(name: string): string | null {
    let bytes: Buffer
    try { bytes = readFileSync(this.path(name)) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12))
      decipher.setAAD(Buffer.from(name))
      decipher.setAuthTag(bytes.subarray(12, 28))
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')
    } catch { throw new AppError('CREDENTIAL_STORE', '服务器凭据无法解密，请检查凭据目录备份。', 503) }
  }
  set(name: string, value: string) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(Buffer.from(name))
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    const path = this.path(name)
    const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`
    try {
      writeFileSync(temporary, Buffer.concat([iv, cipher.getAuthTag(), encrypted]), { flag: 'wx', mode: 0o600 })
      renameSync(temporary, path)
    } finally {
      try { unlinkSync(temporary) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
  }
  remove(name: string) {
    try { unlinkSync(this.path(name)) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
}
