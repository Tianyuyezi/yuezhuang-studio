import { AuthDatabase } from '../server/security/auth'
import { homedir } from 'node:os'
import { join } from 'node:path'
const database = new AuthDatabase(process.env.YZ_DATA_DIR ?? join(homedir(), 'Library', 'Application Support', 'YueZhuangStudio'))
if (!process.stdin.isTTY) { console.error('请在交互式终端中运行账号初始化。'); database.close(); process.exit(1) }
process.stdin.setRawMode(true); process.stdin.resume(); process.stdout.write('请输入默认账号的初始密码（至少 8 位，输入不回显），回车确认：\n')
let password = ''
process.stdin.on('data', async (chunk: Buffer) => {
 const text = chunk.toString('utf8')
 if (text.includes('\u0003')) { database.close(); process.exit(1) }
 password += text.replace(/[\r\n]/g, '')
 if (!/[\r\n]/.test(text)) return
 process.stdin.pause(); process.stdin.setRawMode(false)
 if (password.length < 8 || password.length > 128) { console.error('密码长度需为 8–128 位。'); database.close(); process.exit(1) }
 try { await database.initializeOwnerPassword(password); password=''; console.log('Default owner initialized with a salted password hash.');database.close();process.exit(0) }
 catch {password='';database.close();console.log('Owner was already initialized or initialization failed.');process.exit(1)}
})
