import { createModeConfigs } from './config'

const modeConfigs = createModeConfigs()

export const ppioFields = Object.fromEntries(
  Object.entries(modeConfigs).map(([mode, items]) => [mode, items.filter((item) => item.key !== 'model') as any[]])
)
