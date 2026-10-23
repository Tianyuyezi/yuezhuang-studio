const MODEL_LABELS: Record<string, string> = {
  'gpt-image-2': 'GPT Image 2',
  'gpt-image-2.5-flare': 'GPT Image 2.5 Flare',
  'gpt-image-2.5-sunburst': 'GPT Image 2.5 Sunburst',
  'gpt-image-1.5': 'GPT Image 1.5',
  'gpt-image-1': 'GPT Image 1',
}

export function imageModelLabel(model: string) { return MODEL_LABELS[model] ?? model }

// A manually configured default remains usable when the service has no catalog.
export function availableImageModels(defaultModel: string, catalog: readonly string[]) {
  const order = Object.keys(MODEL_LABELS)
  return [...new Set([defaultModel, ...catalog.filter((model) => /image/i.test(model))])].filter(Boolean).sort((a, b) => {
    const rank = (model: string) => order.includes(model) ? order.indexOf(model) : order.length
    return rank(a) - rank(b) || a.localeCompare(b)
  })
}
