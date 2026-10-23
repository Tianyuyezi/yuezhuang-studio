import { readFile, readdir, writeFile } from 'node:fs/promises'
const directory = 'public/images/examples/prompts'
const records = await Promise.all((await readdir(directory)).filter((name) => /^sample-ai-\d{2}-[ab]\.json$/.test(name)).sort().map(async (name) => JSON.parse(await readFile(`${directory}/${name}`, 'utf8'))))
await writeFile('src/lib/reference-examples.json', JSON.stringify(records.map(({ id, style, width, height }) => ({ id, style, width, height })), null, 2) + '\n')
await writeFile('public/images/examples/prompt-set.json', JSON.stringify({ source: 'imagegen built-in', records }, null, 2))
console.log(JSON.stringify({ count: records.length, styles: [...new Set(records.map((r) => r.style))].length }))
