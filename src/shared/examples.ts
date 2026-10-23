export const SAMPLE_ASSET_IDS = [
  ...Array.from({ length: 6 }, (_, i) => `sample-0${i + 1}`),
  ...Array.from({ length: 24 }, (_, i) => ['a', 'b'].map((variant) => `sample-ai-${String(i + 1).padStart(2, '0')}-${variant}`)).flat(),
]
export function isExampleId(id: string) { return SAMPLE_ASSET_IDS.includes(id) }
