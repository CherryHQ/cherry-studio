import { useState } from 'react'

import type { LocalAgentModelOption } from './useLocalAgentModelSelection'

export function useLocalAgentModelTabs(models: LocalAgentModelOption[], value?: string, showFollowCli = true) {
  const [browsing, setBrowsing] = useState<{ model?: string; source?: string }>({})
  const options: LocalAgentModelOption[] =
    value && !models.some((model) => model.id === value) ? [{ id: value, name: value }, ...models] : models
  const sources = (['native', 'gateway', 'provider'] as const).filter(
    (source) => (source === 'native' && showFollowCli) || options.some((model) => (model.source ?? 'native') === source)
  )
  const selectedSource = options.find((model) => model.id === value)?.source ?? 'native'
  const requestedSource = browsing.model === value ? (browsing.source ?? selectedSource) : selectedSource
  const source = sources.find((source) => source === requestedSource) ?? sources[0] ?? 'native'
  return {
    source,
    sources,
    setSource: (source?: string) => setBrowsing({ model: value, source }),
    models: options.filter((model) => (model.source ?? 'native') === source)
  }
}
