import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StudioDatabase } from '../server/database/client'
import { Keychain } from '../server/security/keychain'
import { OpenAICompatibleProvider } from '../server/providers/openai-compatible'
import { initialWorkspace } from '../server/database/client'
import { PHOTOGRAPHIC_DESCRIPTION } from '../src/shared/photography'
import { EMPTY_SCORES } from '../src/shared/quality'

class TestKeys extends Keychain {
  override async get() { return 'test-token-only' }
  override async set() {}
}

describe('OpenAI compatible wire contracts (mock HTTP only)', () => {
  let directory: string
  let db: StudioDatabase
  let provider: OpenAICompatibleProvider
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'yuezhuang-wire-')); db = new StudioDatabase(directory); provider = new OpenAICompatibleProvider(db, new TestKeys()) })
  afterEach(async () => { vi.unstubAllGlobals(); db.close(); await rm(directory, { recursive: true, force: true }) })
  it('sends generation JSON and decodes base64 without automatic retries', async () => {
    const bytes = Buffer.from('test-only-image-payload')
    const mock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.openai.com/v1/images/generations')
      expect(JSON.parse(init.body as string)).toMatchObject({ model: 'gpt-image-2', n: 1, size: '768x1024', quality: 'high', output_format: 'jpeg' })
      return Response.json({ data: [{ b64_json: bytes.toString('base64') }] })
    })
    vi.stubGlobal('fetch', mock)
    expect((await provider.image({ prompt: 'test', size: '768x1024', images: [] })).bytes).toEqual(bytes)
    expect(mock).toHaveBeenCalledTimes(1)
  })
  it('uses multipart image arrays for edits and does not set a JSON content type', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toContain('/images/edits')
      expect(init.body).toBeInstanceOf(FormData)
      const form = init.body as FormData
      expect(form.getAll('image[]')).toHaveLength(1)
      expect(form.get('prompt')).toBe('edit test')
      expect(form.get('quality')).toBe('high')
      expect(form.get('model')).toBe('gpt-image-2')
      expect((init.headers as Record<string,string>)['Content-Type']).toBeUndefined()
      return Response.json({ data: [{ b64_json: Buffer.from('edited-test').toString('base64') }] })
    }))
    await provider.image({ prompt: 'edit test', size: '1024x1024', images: [{ bytes: Buffer.from('original-test'), mime: 'image/jpeg' }] })
  })
  it.each(['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'])('sends the selected %s for both generation and reference editing', async (model) => {
    const mock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/images/generations')) expect(JSON.parse(init.body as string).model).toBe(model)
      else {
        expect(url).toContain('/images/edits')
        expect((init.body as FormData).get('model')).toBe(model)
      }
      return Response.json({ data: [{ b64_json: Buffer.from('selected-model-result').toString('base64') }] })
    })
    vi.stubGlobal('fetch', mock)
    await provider.image({ model, prompt: 'test', size: '1024x1024', images: [] })
    await provider.image({ model, prompt: 'test', size: '1024x1024', images: [{ bytes: Buffer.from('test-reference'), mime: 'image/png' }] })
    expect(mock).toHaveBeenCalledTimes(2)
    expect(provider.config().imageModel).toBe('gpt-image-2')
  })
  it('uses the service catalog for image choices, without inventing unavailable 2.5 models', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: ['gpt-6.1-sol', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-sunburst'].map((id) => ({ id })) })))
    await provider.testConnection()
    expect(provider.imageModels()).toEqual(['gpt-image-2', 'gpt-image-2.5-sunburst'])
  })
  it('uses Responses structured JSON, the selected model and store:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string)).toMatchObject({ model: 'gpt-6.1-sol', store: false, text: { format: { type: 'json_schema', strict: true } } })
      return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ title: 'Title', body: 'Body', hashtags: ['Makeup'] }) }] }] })
    }))
    expect(await provider.caption({ language: 'English', prompt: '{}' })).toEqual({ title: 'Title', body: 'Body', hashtags: ['Makeup'] })
  })
  it('reports the actual disabled image-group permission and does not retry', async () => {
    const mock = vi.fn(async () => Response.json({ error: { message: 'Image generation is not enabled for this group' } }, { status: 403 }))
    vi.stubGlobal('fetch', mock)
    await expect(provider.image({ prompt: 'test', size: '1024x1024', images: [] })).rejects.toMatchObject({ code: 'IMAGE_NOT_ENABLED' })
    expect(mock).toHaveBeenCalledTimes(1)
  })
  it('rejects invalid caption JSON instead of returning partial invented text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'not json' }] }] })))
    await expect(provider.caption({ language: 'English', prompt: '{}' })).rejects.toMatchObject({ code: 'CAPTION_INVALID' })
  })
  it('blocks image download URLs into private addresses', async () => {
    await expect(provider.downloadImage('https://127.0.0.1/internal')).rejects.toMatchObject({ code: 'IMAGE_URL_PRIVATE' })
  })
  it('sends group pictures as vision inputs for one shared carousel caption', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      const images = body.input[0].content.filter((item: { type: string }) => item.type === 'input_image')
      expect(images).toHaveLength(2)
      expect(images[0].image_url).toBe(`data:image/jpeg;base64,${Buffer.from('first').toString('base64')}`)
      expect(body.input[0].content[0].text).toContain('shared carousel-post caption')
      return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ title: 'Group', body: 'One look.', hashtags: [] }) }] }] })
    }))
    await provider.caption({ language: 'English', prompt: '{}', images: ['first', 'second'].map((value) => ({ bytes: Buffer.from(value), mime: 'image/jpeg' })) })
  })
  it('combines random casting, outfit and makeup style without losing selected values', async () => {
    const draft = { ...initialWorkspace().draft, style: '港风红唇', randomModel: { occupation: '律师', age: 32, outfit: '炭灰西装', country: '法国', ethnicity: '东亚面孔' } }
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      const context = JSON.parse(body.input[0].content[0].text)
      expect(context.requiredFictionalCharacter).toEqual(draft.randomModel)
      expect(body.store).toBe(false)
      return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ prompt: '干净底妆，复古红唇，柔和的侧面光，保留肌肤纹理。' }) }] }] })
    }))
    const result = await provider.prompt({ action: 'random', draft, model: null, variation: {}, images: [] })
    for (const text of ['律师', '32', '炭灰西装', '法国', '东亚面孔', '港风红唇']) expect(result.prompt).toContain(text)
    expect(result.prompt).toContain(PHOTOGRAPHIC_DESCRIPTION)
  })
  it('keeps the photographic requirement through repeated polishing and rejects oversized descriptions', async () => {
    let generated = `保留原人物的红唇、发型和灰色西装。\n\n${PHOTOGRAPHIC_DESCRIPTION}`
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      expect(body.instructions).toContain('Photorealistic portrait')
      expect(body.instructions).toContain('never expand the scope')
      return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ prompt: generated }) }] }] })
    }))
    const input = { action: 'polish' as const, draft: { ...initialWorkspace().draft, mode: 'edit' as const, prompt: generated }, model: null, variation: null, images: [] }
    const result = await provider.prompt(input)
    expect(result.prompt.split(PHOTOGRAPHIC_DESCRIPTION)).toHaveLength(2)
    expect(result.prompt).toContain('保留原人物的红唇、发型和灰色西装')
    generated = '妆'.repeat(1990)
    await expect(provider.prompt(input)).rejects.toMatchObject({ code: 'PROMPT_INVALID' })
  })
  it('generates descriptions with unspecified character fields while keeping an adult photographic subject', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      const context = JSON.parse(body.input[0].content[0].text)
      expect(context.fixedOpening).toContain('成年人物')
      expect(context.fixedOpening).not.toMatch(/null|undefined|年龄|身穿/)
      expect(context.writingRule).toContain('Blank strings and null mean unspecified')
      return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ prompt: '轻薄底妆与豆沙红唇，自然室内光，放松的头肩构图。' }) }] }] })
    }))
    const result = await provider.prompt({ action: 'random', draft: initialWorkspace().draft, model: null, variation: {}, images: [] })
    expect(result.prompt).toContain('成年人物')
    expect(result.prompt).toContain(PHOTOGRAPHIC_DESCRIPTION)
    expect(result.prompt).not.toMatch(/null|undefined/)
  })
  it('passes selected model references for polishing and rejects malformed results', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      expect(body.input[0].content[1].type).toBe('input_image')
      expect(JSON.parse(body.input[0].content[0].text).model.name).toBe('Archive model')
      return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ prompt: '' }) }] }] })
    }))
    await expect(provider.prompt({ action: 'polish', draft: { ...initialWorkspace().draft, modelId: 'model-01', prompt: '保留原衣服和发型' }, model: { name: 'Archive model' }, variation: null, images: [{ bytes: Buffer.from('model-reference'), mime: 'image/jpeg' }] })).rejects.toMatchObject({ code: 'PROMPT_INVALID' })
  })
  it('analyzes real image inputs as visual reconstruction, keeps scores tentative and ignores screenshot UI', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      expect(body.store).toBe(false)
      expect(body.model).toBe('gpt-6.1-sol')
      expect(body.input[0].content.filter((v: { type: string }) => v.type === 'input_image')).toHaveLength(1)
      expect(body.instructions).toContain('not recovery of the original prompt')
      expect(body.instructions).toContain('carousel counters')
      return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ prompt: '虚构成年人物，浓密卷翘睫毛与真实唇纹，粉棕腮红及单侧柔光。', observations: { realism: '细微肌理', makeup: '上扬眼线', lighting: '单侧柔光', composition: '头肩近景', consistency: '单图不适用' }, avoid: ['截图箭头'], suggestedScores: { ...EMPTY_SCORES, realism: 4.2, consistency: 5 } }) }] }] })
    }))
    const result = await provider.analyze({ title: 'Reference', style: '港风红唇', images: [{ bytes: Buffer.from('actual-reference-bytes'), mime: 'image/jpeg' }] })
    expect(result.prompt).toContain(PHOTOGRAPHIC_DESCRIPTION)
    expect(result.prompt).toContain('浓密卷翘睫毛')
    expect(result.suggestedScores.consistency).toBeNull()
  })
  it('rejects invalid reference analysis rather than inventing a fallback prompt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }] })))
    await expect(provider.analyze({ title: 'Reference', style: '', images: [] })).rejects.toMatchObject({ code: 'ANALYSIS_INVALID' })
  })
})
