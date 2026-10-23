import { mkdir, copyFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import sharp from 'sharp'

const [id, style, source, prompt] = process.argv.slice(2)
if (!/^sample-ai-(?:0[1-9]|1[0-9]|2[0-4])-[ab]$/.test(id) || !style || !source || !prompt) throw new Error('Invalid reference example')
const directory = resolve('public/images/examples')
await mkdir(join(directory, 'prompts'), { recursive: true })
await mkdir('output/qa/reference-examples', { recursive: true })
await copyFile(source, join(directory, id + '.png'))
const image = sharp(source)
const { width, height } = await image.metadata()
await image.resize({ width: 600, height: 800, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(join(directory, id + '-thumb.jpg'))
const record = { id, style, width, height, source: 'imagegen built-in', prompt, createdAt: Date.now() }
await writeFile(join(directory, 'prompts', id + '.json'), JSON.stringify(record, null, 2))
await writeFile(resolve('output/qa/reference-examples', id + '.json'), JSON.stringify(record, null, 2))
console.log(JSON.stringify({ id, style, width, height }))
