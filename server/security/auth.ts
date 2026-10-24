import Database from 'better-sqlite3'
import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { AppError } from '../errors'
import type { AuthSession, AuthUser } from '../../src/shared/auth'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)))
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex')
  return `scrypt$32768$8$3$${salt}$${(await derive(password, salt)).toString('hex')}`
}
export interface ServerSession { tokenHash: string; user: AuthUser | null; guestId: string; csrf: string; expiresAt: number; workspaceKey: string }
interface UserRow { id: string; email: string; password_hash: string | null; role: 'owner' | 'member'; created_at: number }
interface SessionRow { token_hash: string; user_id: string | null; guest_id: string; csrf: string; expires_at: number }
const userView = (row: UserRow): AuthUser => ({ id: row.id, email: row.email, role: row.role, createdAt: row.created_at })

export class AuthDatabase {
  readonly sqlite: Database.Database
  private dummy = `scrypt$32768$8$3$${randomBytes(16).toString('hex')}$${randomBytes(64).toString('hex')}`
  constructor(directory: string, ownerEmail = 'tianyuyezi@gmail.com') {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    this.sqlite = new Database(join(directory, 'auth.sqlite'))
    chmodSync(join(directory, 'auth.sqlite'), 0o600)
    this.sqlite.pragma('journal_mode = WAL'); this.sqlite.pragma('foreign_keys = ON'); this.sqlite.pragma('busy_timeout = 5000')
    this.sqlite.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,password_hash TEXT,role TEXT NOT NULL CHECK(role IN ('owner','member')),created_at INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_legacy_owner ON users(role) WHERE role='owner';
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),guest_id TEXT NOT NULL,csrf TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_attempts (key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL);`)
    if (!this.sqlite.prepare("SELECT id FROM users WHERE role='owner'").get()) this.sqlite.prepare('INSERT INTO users VALUES (?,?,NULL,?,?)').run(randomUUID(), ownerEmail.trim().toLowerCase(), 'owner', Date.now())
    this.sqlite.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now())
    this.sqlite.prepare('DELETE FROM auth_attempts WHERE expires_at<?').run(Date.now())
  }
  users() { return (this.sqlite.prepare('SELECT * FROM users').all() as UserRow[]).map(userView) }
  owner() { return this.users().find((user) => user.role === 'owner')! }
  async initializeOwnerPassword(password: string) {
    const row = this.sqlite.prepare("SELECT * FROM users WHERE role='owner'").get() as UserRow
    if (row.password_hash) throw new AppError('OWNER_INITIALIZED', '默认账号已经设置密码，未作更改。', 409)
    const hash = await passwordHash(password)
    const result = this.sqlite.prepare('UPDATE users SET password_hash=? WHERE id=? AND password_hash IS NULL').run(hash, row.id)
    if (!result.changes) throw new AppError('OWNER_INITIALIZED', '默认账号已经设置密码，未作更改。', 409)
  }
  private throttle(key: string, max: number) {
    const row = this.sqlite.prepare('SELECT count,expires_at FROM auth_attempts WHERE key=?').get(digest(key)) as { count: number; expires_at: number } | undefined
    if (row && row.expires_at > Date.now() && row.count >= max) throw new AppError('AUTH_RATE_LIMIT', '尝试次数较多，请 15 分钟后再试。', 429)
  }
  private attempt(key: string) {
    this.sqlite.prepare('INSERT INTO auth_attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END').run(digest(key), Date.now() + 15 * 60000, Date.now(), Date.now())
  }
  async login(email: string, password: string, address: string) {
    this.throttle(`email:${email}`, 8); this.throttle(`ip:${address}`, 60)
    const row = this.sqlite.prepare('SELECT * FROM users WHERE email=?').get(email) as UserRow | undefined
    const encoded = row?.password_hash ?? this.dummy
    const pieces = encoded.split('$'), salt = pieces[4], expected = Buffer.from(pieces[5], 'hex')
    const computed = await derive(password, salt)
    if (!row?.password_hash || expected.length !== computed.length || !timingSafeEqual(computed, expected)) {
      this.attempt(`email:${email}`); this.attempt(`ip:${address}`)
      throw new AppError('INVALID_CREDENTIALS', '邮箱或密码不正确。', 401)
    }
    this.sqlite.prepare('DELETE FROM auth_attempts WHERE key=?').run(digest(`email:${email}`))
    return userView(row)
  }
  async register(email: string, password: string, address: string) {
    this.throttle(`register:${address}`, 12); this.attempt(`register:${address}`)
    const hash = await passwordHash(password), user: AuthUser = { id: randomUUID(), email, role: 'member', createdAt: Date.now() }
    try { this.sqlite.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(user.id, email, hash, user.role, user.createdAt) }
    catch (error) { if ((error as { code?: string }).code?.startsWith('SQLITE_CONSTRAINT')) throw new AppError('EMAIL_UNAVAILABLE', '该邮箱无法注册，请直接登录或换一个邮箱。', 409); throw error }
    return user
  }
  session(token: string | undefined): ServerSession | null {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null
    const row = this.sqlite.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(digest(token), Date.now()) as SessionRow | undefined
    if (!row) return null
    const user = row.user_id ? this.sqlite.prepare('SELECT * FROM users WHERE id=?').get(row.user_id) as UserRow | undefined : undefined
    if (row.user_id && !user) return null
    return { tokenHash: row.token_hash, user: user ? userView(user) : null, guestId: row.guest_id, csrf: row.csrf, expiresAt: row.expires_at, workspaceKey: user ? `user-${user.id}` : `guest-${row.guest_id}` }
  }
  createSession(user: AuthUser | null, guestId: string = randomUUID(), previous?: ServerSession) {
    const token = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex')
    this.sqlite.transaction(() => {
      this.sqlite.prepare('INSERT INTO sessions VALUES (?,?,?,?,?)').run(digest(token), user?.id ?? null, guestId, csrf, Date.now() + (user ? 7 : 1) * 86400000)
      if (previous) this.sqlite.prepare('DELETE FROM sessions WHERE token_hash=?').run(previous.tokenHash)
    })()
    return { token, session: this.session(token)! }
  }
  view(session: ServerSession): AuthSession { return { csrf: session.csrf, user: session.user, workspaceKey: session.workspaceKey } }
  close() { this.sqlite.close() }
}
