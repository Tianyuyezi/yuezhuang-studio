import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Server } from 'node:http'
import sharp from 'sharp'
import { createStudioApp } from '../server/account-app'
import { Keychain } from '../server/security/keychain'
import type { AuthSession } from '../src/shared/auth'
import type { Snapshot } from '../src/lib/api'
import { emptyCaptions } from '../src/lib/data'

class MemoryKeys extends Keychain {
 override readonly storage = 'session' as const
 values = new Map<string,string>()
 override async get(key:string) {return this.values.get(key) ?? null}
 override async set(key:string,value:string) {this.values.set(key,value)}
 override async remove(key:string) {this.values.delete(key)}
}
interface Client { cookie: string; session: AuthSession }
describe('optional login, owner migration, and isolated account workspaces', () => {
 let directory:string, runtime:ReturnType<typeof createStudioApp>, server:Server, base:string, ownerAsset:string
 const ownerEmail='tianyuyezi@gmail.com', password='owner-test-password'
 async function client():Promise<Client> {const r=await fetch(base+'/api/session');return {cookie:r.headers.get('set-cookie')!.split(';')[0],session:await r.json()}}
 async function call(c:Client,path:string,method='GET',body?:unknown,headers:Record<string,string>={}) {return fetch(base+'/api'+path,{method,headers:{Cookie:c.cookie,'X-YZ-CSRF':c.session.csrf,'X-YZ-Workspace':c.session.workspaceKey,...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})})}
 async function sign(c:Client,email=ownerEmail,action='login',extra:object={}) {const r=await call(c,'/auth/'+action,'POST',{email,password,...extra});if(r.ok){c.cookie=r.headers.get('set-cookie')!.split(';')[0];c.session=await r.json()}return r}
 async function snapshot(c:Client):Promise<Snapshot>{return (await call(c,'/workspace')).json()}
 async function open() {runtime=createStudioApp({dataDir:directory,publicDir:resolve('public'),keys:new MemoryKeys(),keyFactory:()=>new MemoryKeys()});server=runtime.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));base=`http://127.0.0.1:${(server.address() as {port:number}).port}`}
 beforeEach(async()=>{
  directory=await mkdtemp(join(tmpdir(),'yz-auth-'));await open();await runtime.auth.initializeOwnerPassword(password)
  runtime.database.mutateWorkspace(s=>({...s,settings:{...s.settings,studioName:'owner-private-studio'}}))
  const image=await runtime.assets.save(await sharp({create:{width:30,height:40,channels:3,background:'#abc'}}).png().toBuffer(),'owner-private-photo');ownerAsset=image.id
  await runtime.provider.configure({...runtime.provider.config(),baseUrl:'https://private-ai.example.com/v1'},'OWNER_PRIVATE_API_KEY_12345')
 })
 afterEach(async()=>{await new Promise<void>(r=>server.close(()=>r()));runtime.close();await rm(directory,{recursive:true,force:true})})
 it('lets visitors explore and save creative drafts without exposing owner data or permitting configuration',async()=>{
  const guest=await client();expect(guest.session.user).toBeNull()
  const s=await snapshot(guest);expect(s.state.importedAssets).toHaveLength(0);expect(s.state.settings.studioName).not.toContain('owner-private')
  expect((await call(guest,`/assets/${ownerAsset}/file`)).status).toBe(404)
  const provider=await(await call(guest,'/provider')).json();expect(provider.hasKey).toBe(false);expect(provider.baseUrl).not.toContain('private-ai')
  for(const [path,method,body] of [['/instagram','GET',undefined],['/instagram/publications/prepare','POST',{}],['/provider','PUT',{}],['/provider/test','POST',{}],['/provider/key','DELETE',undefined],['/quality-preferences','PUT',{}]] as const) expect((await call(guest,path,method,body)).status).toBe(401)
  const state={...s.state,draft:{...s.state.draft,prompt:'A visitor creative draft'}}
  expect((await call(guest,'/workspace','PUT',{revision:s.revision,state})).status).toBe(200)
  const saved=await snapshot(guest)
  expect((await call(guest,'/workspace','PUT',{revision:saved.revision,state:{...saved.state,settings:{...saved.state.settings,studioName:'changed'}}})).status).toBe(401)
  expect((await snapshot(guest)).state.draft.prompt).toBe('A visitor creative draft')
  expect(runtime.database.snapshot().state.settings.studioName).toBe('owner-private-studio')
 })
 it('logs the reserved owner into the original workspace, rotates sessions, and never exports password hashes',async()=>{
  const c=await client(),oldCookie=c.cookie,oldCsrf=c.session.csrf
  const login=await sign(c,ownerEmail.toUpperCase());expect(login.status).toBe(200);expect(c.session.user?.role).toBe('owner');expect(c.session.csrf).not.toBe(oldCsrf)
  expect(login.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Strict; Path=\/api/)
  expect(c.cookie).not.toBe(oldCookie);expect((await fetch(base+'/api/workspace',{headers:{Cookie:oldCookie}})).status).toBe(401)
  const s=await snapshot(c);expect(s.state.settings.studioName).toBe('owner-private-studio');expect(s.state.importedAssets[0].id).toBe(ownerAsset)
  expect((await(await call(c,'/provider')).json()).hasKey).toBe(true)
  const hash=(runtime.auth.sqlite.prepare('SELECT password_hash FROM users WHERE email=?').get(ownerEmail) as {password_hash:string}).password_hash
  expect(hash).toMatch(/^scrypt\$32768\$8\$3\$/);expect(hash).not.toContain(password)
  for(const path of ['/export','/backup']) {const text=await(await call(c,path)).text();expect(text).not.toContain(hash);expect(text).not.toContain('OWNER_PRIVATE_API_KEY_12345')}
  const retained=await fetch(base+'/api/session',{headers:{Cookie:c.cookie}});expect((await retained.json()).user.email).toBe(ownerEmail)
 })
 it('registers separate accounts without inheriting data, keys, roles, or the other workspace permissions',async()=>{
  const a=await client(),b=await client();expect((await sign(a,'first@example.com','register',{role:'owner',id:runtime.auth.owner().id})).status).toBe(200)
  expect(a.session.user?.role).toBe('member');expect((await sign(b,'second@example.com','register')).status).toBe(200)
  const s=await snapshot(a);expect(s.state.importedAssets).toHaveLength(0)
  expect((await call(a,'/workspace','PUT',{revision:s.revision,state:{...s.state,settings:{...s.state.settings,studioName:'first-private-studio'}}})).status).toBe(200)
  const config={...(await(await call(a,'/provider')).json()),baseUrl:'https://first-ai.example.com/v1',apiKey:'FIRST_PRIVATE_API_KEY_12345'}
  expect((await call(a,'/provider','PUT',config)).status).toBe(200)
  expect((await snapshot(b)).state.settings.studioName).not.toBe('first-private-studio')
  expect((await(await call(b,'/provider')).json()).hasKey).toBe(false)
  expect((await(await call(b,'/export')).text())).not.toContain('first-private-studio')
  expect((await call(a,'/workspace','GET',undefined,{'X-YZ-Workspace':b.session.workspaceKey})).status).toBe(409)
  expect((await call(a,'/workspace','PUT',{revision:s.revision,state:s.state},{'X-YZ-Workspace':b.session.workspaceKey})).status).toBe(409)
  const duplicate=await client();expect((await sign(duplicate,'FIRST@example.com','register')).status).toBe(409)
  const reserved=await client();expect((await sign(reserved,ownerEmail,'register')).status).toBe(409)
 })
 it('requires CSRF, revokes logout tokens, restores the visitor workspace, and rejects stale-account saves',async()=>{
  const c=await client(),visitorKey=c.session.workspaceKey,s=await snapshot(c)
  expect((await call(c,'/workspace','PUT',{revision:s.revision,state:{...s.state,draft:{...s.state.draft,prompt:'visitor-only'}}})).status).toBe(200)
  expect((await call(c,'/auth/login','POST',{email:ownerEmail,password},{'X-YZ-CSRF':''})).status).toBe(403)
  await sign(c);const loggedCookie=c.cookie,ownerKey=c.session.workspaceKey
  expect((await call(c,'/workspace','PUT',{revision:0,state:s.state},{'X-YZ-Workspace':visitorKey})).status).toBe(409)
  const out=await call(c,'/auth/logout','POST');expect(out.status).toBe(200);c.cookie=out.headers.get('set-cookie')!.split(';')[0];c.session=await out.json()
  expect(c.session.user).toBeNull();expect(c.session.workspaceKey).toBe(visitorKey);expect((await snapshot(c)).state.draft.prompt).toBe('visitor-only')
  expect((await fetch(base+'/api/workspace',{headers:{Cookie:loggedCookie}})).status).toBe(401)
  expect((await call(c,'/workspace','GET',undefined,{'X-YZ-Workspace':ownerKey})).status).toBe(409)
  expect(runtime.database.snapshot().state.settings.studioName).toBe('owner-private-studio')
 })
 it('keeps sessions across restart but rejects expired sessions and malformed credentials',async()=>{
  const c=await client();expect((await sign(c)).status).toBe(200)
  await new Promise<void>(r=>server.close(()=>r()));runtime.close();await open()
  expect((await snapshot(c)).state.settings.studioName).toBe('owner-private-studio')
  runtime.auth.sqlite.prepare('UPDATE sessions SET expires_at=?').run(Date.now()-1)
  expect((await call(c,'/workspace')).status).toBe(401)
  const fresh=await client();expect(fresh.session.user).toBeNull()
  expect((await call(fresh,'/auth/register','POST',{email:'bad-email',password:'short'})).status).toBe(400)
 })
 it('carries explicitly selected visitor creations into the owner without copying settings or losing existing data',async()=>{
  const c=await client()
  const bytes=await sharp({create:{width:25,height:35,channels:3,background:'#def'}}).png().toBuffer()
  const upload=await fetch(base+'/api/assets',{method:'POST',headers:{Cookie:c.cookie,'X-YZ-CSRF':c.session.csrf,'X-YZ-Workspace':c.session.workspaceKey,'Content-Type':'image/png'},body:bytes});expect(upload.status).toBe(201)
  const asset=await upload.json(),s=await snapshot(c)
  const captions=emptyCaptions();captions.zh={title:'体验作品',body:'体验文案',hashtags:'#Makeup',locked:false}
  const state={...s.state,draft:{...s.state.draft,prompt:'carry this creative draft'},workflow:{...s.state.workflow,step:4,groupId:asset.groupId,assetIds:[asset.id]},groupCaptions:{[asset.groupId]:captions}}
  expect((await call(c,'/workspace','PUT',{revision:s.revision,state})).status).toBe(200)
  expect((await sign(c,ownerEmail,'login',{importGuest:true})).status).toBe(200)
  const account=await snapshot(c)
  expect(account.state.settings.studioName).toBe('owner-private-studio');expect(account.state.importedAssets.map(a=>a.id)).toContain(ownerAsset);expect(account.state.importedAssets.map(a=>a.id)).toContain(asset.id)
  expect(account.state.draft.prompt).toBe('carry this creative draft');expect(account.state.workflow.step).toBe(4);expect(account.state.groupCaptions[asset.groupId].zh.body).toBe('体验文案')
  expect((await(await call(c,'/provider')).json()).hasKey).toBe(true)
 })
 it('limits failed password attempts without revealing whether the email exists',async()=>{
  const c=await client()
  for(let n=0;n<8;n++) {const r=await call(c,'/auth/login','POST',{email:ownerEmail,password:'incorrect-password'});expect(r.status).toBe(401);expect((await r.json()).error.code).toBe('INVALID_CREDENTIALS')}
  expect((await call(c,'/auth/login','POST',{email:ownerEmail,password})).status).toBe(429)
  const unknown=await call(c,'/auth/login','POST',{email:'unknown@example.com',password:'incorrect-password'});expect(unknown.status).toBe(401);expect((await unknown.json()).error.code).toBe('INVALID_CREDENTIALS')
 },15000)
})
