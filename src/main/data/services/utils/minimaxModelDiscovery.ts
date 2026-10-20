const legacyMiniMaxTextModels = new Set([
  'minimax-01',
  'minimax-m1',
  'minimax-m2',
  'minimax-m2-1',
  'minimax-m2-1-lightning',
  'minimax-m2-5',
  'minimax-m2-5-highspeed',
  'minimax-m2-7',
  'minimax-m2-7-highspeed',
  'minimax-m2-her'
])

const currentMiniMaxTextModels = ['minimax-m3-1-flash', 'minimax-m3']

/** Discovery only: keep legacy registry records available to saved models and history. */
export function selectCurrentMiniMaxModels<T extends { presetModelId?: string | null }>(
  models: T[],
  getPresetModelId: (model: T) => string = (model) => model.presetModelId ?? ''
): T[] {
  const visible = models.filter((model) => !legacyMiniMaxTextModels.has(getPresetModelId(model)))
  const current = visible
    .filter((model) => currentMiniMaxTextModels.includes(getPresetModelId(model)))
    .sort(
      (a, b) =>
        currentMiniMaxTextModels.indexOf(getPresetModelId(a)) - currentMiniMaxTextModels.indexOf(getPresetModelId(b))
    )
  let index = 0
  // Replace only the current MiniMax slots so unrelated models retain their order.
  return visible.map((model) => (currentMiniMaxTextModels.includes(getPresetModelId(model)) ? current[index++] : model))
}
