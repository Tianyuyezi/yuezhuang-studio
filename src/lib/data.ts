import type { Asset, CaptionSet, CreationDraft, ModelProfile } from './types'

export { STYLES } from './style-presets'
import { STYLE_RECIPES } from './style-presets'
import { photographicDescription } from '../shared/photography'

export const SAMPLE_ASSETS: Asset[] = [
  { id: 'sample-01', title: '清透底妆参考', src: '/images/portrait-01.jpg', style: '韩系清透', kind: 'example', createdAt: 0 },
  { id: 'sample-02', title: '冷调人像参考', src: '/images/portrait-02.jpg', style: '法式复古', kind: 'example', createdAt: 0 },
  { id: 'sample-03', title: '柔光人像参考', src: '/images/portrait-03.jpg', style: '新娘柔光', kind: 'example', createdAt: 0 },
  { id: 'sample-04', title: '日常妆容参考', src: '/images/portrait-04.jpg', style: '时尚大片', kind: 'example', createdAt: 0 },
  { id: 'sample-05', title: '暖色人像参考', src: '/images/portrait-05.jpg', style: '自然裸妆', kind: 'example', createdAt: 0 },
  { id: 'sample-06', title: '自然肌理参考', src: '/images/portrait-06.jpg', style: '创意彩妆', kind: 'example', createdAt: 0 },
]

export const SAMPLE_MODELS: ModelProfile[] = [
  { id: 'model-01', name: 'Luna', description: '柔和轮廓，自然松弛的镜头感。适合清透底妆与日常妆容的风格参考。', assetId: 'sample-01', tags: ['清透', '自然'], example: true },
  { id: 'model-02', name: 'Chloé', description: '鲜明五官与复古气质。适合探索暖色妆容和法式风格。', assetId: 'sample-02', tags: ['复古', '优雅'], example: true },
  { id: 'model-03', name: 'Mia', description: '温柔明亮的氛围。适合柔光、新娘与浪漫风格的创作参考。', assetId: 'sample-03', tags: ['柔光', '浪漫'], example: true },
]

export const INITIAL_DRAFT: CreationDraft = {
  mode: 'virtual', prompt: '', style: '韩系清透', modelId: null, ratio: '3:4', count: 4, referenceId: null, imageModel: null,
}

const STYLE_PROMPT_DETAILS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(STYLE_RECIPES).map(([style, recipe]) => [style, `一位虚构的成年人物，${style}。${recipe.detail}，以${recipe.palettes[0]}为配色。妆造协调，突出真实肌肤质感与妆容细节。`])),
  韩系清透: '一位虚构的成年人物，韩系清透妆容。轻盈水光底妆，柔和杏粉色眼影，自然根根分明的睫毛，低饱和裸粉唇。奶油色背景，窗边柔和自然光，近景人像，保留真实肌肤质感。',
  法式复古: '一位虚构的成年人物，法式复古妆容。柔雾底妆，精致细眼线，浓郁玫瑰红唇，自然眉形。松弛的微卷发，温暖的胶片色调，简洁背景，平视的自然人像照片。',
  新娘柔光: '一位虚构的成年人物，温柔的新娘妆容。通透细腻的底妆，香槟色眼影，淡粉色腮红和水润唇妆。精致盘发，珍珠耳饰，象牙白背景，柔和漫射光。',
  时尚大片: '一位虚构的成年人物，现代时尚大片的美妆摄影。轻薄的立体底妆，利落的眼线，低饱和唇色。简洁造型，真实灰色墙面，方向明确的柔和侧光，特写构图。',
  自然裸妆: '一位虚构的成年人物，自然裸妆。保留肌肤纹理，轻薄均匀的底妆，柔和眉形，浅棕色眼影和自然豆沙唇。清晨自然光，浅米色背景，轻松舒展的表情。',
  创意彩妆: '一位虚构的成年人物，艺术创意妆容。精致底妆，带有春日色彩的眼影，轻盈的珠光细节。色彩和谐的简洁背景，真实人像摄影，突出眼妆设计与实际颜料质感。',
}

export const STYLE_PROMPTS: Record<string, string> = Object.fromEntries(Object.entries(STYLE_PROMPT_DETAILS).map(([style, prompt]) => [style, photographicDescription(prompt)]))

export const emptyCaptions = (): CaptionSet => ({
  zh: { title: '', body: '', hashtags: '', locked: false },
  en: { title: '', body: '', hashtags: '', locked: false },
  ko: { title: '', body: '', hashtags: '', locked: false },
})

export const EXAMPLE_CAPTIONS: CaptionSet = {
  zh: { title: '让自然光，成为妆容的一部分', body: '轻盈的底妆，温柔的杏粉色，和恰到好处的光泽。\n把关于美的灵感，留在这一刻。\n\n本内容为 AI 虚拟妆容创作的文案示例。', hashtags: '#妆容灵感 #清透妆容 #虚拟模特 #AI创作', locked: false },
  en: { title: 'A little glow, a softer mood.', body: 'Sheer skin, soft apricot tones, and a touch of light.\nA quiet study in everyday beauty.\n\nSample caption for an AI virtual makeup concept.', hashtags: '#MakeupInspiration #SoftGlam #VirtualModel #AIArt', locked: false },
  ko: { title: '빛을 머금은, 맑은 아름다움', body: '가벼운 베이스와 부드러운 살구빛, 은은하게 빛나는 피부.\n일상 속 아름다움에서 찾은 작은 영감.\n\nAI 가상 메이크업 콘셉트를 위한 예시 문구입니다.', hashtags: '#메이크업 #맑은메이크업 #가상모델 #AI아트', locked: false },
}

export const LANGUAGES = [{ id: 'zh' as const, label: '中文', short: '中' }, { id: 'en' as const, label: 'English', short: 'EN' }, { id: 'ko' as const, label: '한국어', short: '한' }]
