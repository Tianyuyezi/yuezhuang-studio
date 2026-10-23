import type { CreationDraft } from './types'

export const MODEL_OCCUPATIONS = ['律师', '上班族', '设计师', '教师', '医生', '艺术家', '自由职业者', '建筑师', '摄影师', '编辑', '策展人', '咖啡师', '音乐人', '创业者', '模特']
export function randomOccupation(current = '') {
  const options = MODEL_OCCUPATIONS.filter((value) => value !== current)
  return options[Math.floor(Math.random() * options.length)]
}
export const MODEL_OUTFITS = ['炭灰西装与浅色衬衫', '简洁针织上衣与长裤', '有设计感的黑色套装', '奶油色衬衫与半身裙', '简约白色连衣裙', '轻松休闲的牛仔穿搭', '深蓝衬衫与米色西裤', '丝质上衣与高腰长裤', '墨绿针织开衫与直筒长裙', '暖棕色夹克与纯色内搭']
export const MODEL_COUNTRIES = ['中国', '日本', '韩国', '法国', '意大利', '美国', '英国', '加拿大', '巴西', '印度', '西班牙', '墨西哥', '南非', '泰国', '越南']
export const MODEL_APPEARANCES = ['东亚面孔', '南亚面孔', '东南亚面孔', '欧洲面孔', '非洲面孔', '中东面孔', '拉美混合背景面孔', '多元混合背景面孔']
export const DEFAULT_RANDOM_MODEL = { occupation: '', age: null as number | null, outfit: '', country: '', ethnicity: '' }
const chooseDifferent = (values: string[], current: string) => { const options = values.filter((value) => value !== current); return options[Math.floor(Math.random() * options.length)] }
export const randomCountry = (current = '') => chooseDifferent(MODEL_COUNTRIES, current)
export const randomAppearance = (current = '') => chooseDifferent(MODEL_APPEARANCES, current)
export function randomAge(current: number | null = null) {
  const ages = [22, 25, 28, 30, 32, 35, 38, 42, 45, 50, 55, 60].filter((age) => age !== current)
  return ages[Math.floor(Math.random() * ages.length)]
}
export function randomOutfit(current = '') {
  const outfits = MODEL_OUTFITS.filter((value) => value !== current)
  return outfits[Math.floor(Math.random() * outfits.length)]
}
export function characterPromptPrefix(draft: CreationDraft) {
  if (draft.mode !== 'virtual' || draft.modelId !== null) return `妆容风格：${draft.style}。`
  const details = characterSettingDetails(draft.randomModel)
  return `一位虚构的成年人物。${details ? `人物设定：${details}。` : ''}妆容风格：${draft.style}。`
}

export function characterSettingDetails(profile: CreationDraft['randomModel']) {
  return [
    profile?.occupation.trim() ? `身份为${profile.occupation.trim()}` : '',
    profile?.age != null ? `年龄${profile.age}岁` : '',
    profile?.country?.trim() ? `国家／地区设定为${profile.country.trim()}` : '',
    profile?.ethnicity?.trim() ? `人物外观为${profile.ethnicity.trim()}` : '',
    profile?.outfit.trim() ? `身穿${profile.outfit.trim()}` : '',
  ].filter(Boolean).join('，')
}

export function invalidRandomModelField(draft: CreationDraft): { field: string; message: string } | null {
  if (draft.mode !== 'virtual' || draft.modelId !== null) return null
  const age = draft.randomModel?.age
  if (age != null && (!Number.isInteger(age) || age < 18 || age > 100)) return { field: 'random-model-age', message: '年龄可留空；填写时请使用 18–100 岁的整数。' }
  return null
}
