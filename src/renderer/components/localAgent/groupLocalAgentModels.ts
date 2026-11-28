import type { LocalAgentModelOption } from '@renderer/hooks/agent/useLocalAgentModelSelection'
import { getSearchMatchScore } from '@renderer/utils/model'

type ModelEntry = { key: string; label: string; model?: LocalAgentModelOption; score: number }
type ModelGroup = { key: string; label: string; entries: ModelEntry[] }

export function groupLocalAgentModels(
  models: LocalAgentModelOption[],
  {
    officialLabel,
    ungroupedLabel,
    followCliLabel,
    value,
    search
  }: { officialLabel: string; ungroupedLabel: string; followCliLabel?: string; value?: string; search: string }
) {
  const official: ModelGroup = { key: 'native', label: officialLabel, entries: [] }
  const providers = new Map<string, ModelGroup>()
  const query = search.trim()
  const options =
    value && !models.some((model) => model.id === value) ? [{ id: value, name: value }, ...models] : models
  for (const model of followCliLabel ? [undefined, ...options] : options) {
    const gateway = model?.source === 'gateway'
    const groupLabel = gateway ? (model.group ?? ungroupedLabel) : officialLabel
    const label = model ? model.name || model.id : followCliLabel
    if (!label) continue
    const score = query
      ? getSearchMatchScore(query, [
          { value: label, weight: 0, allowAbbreviation: true },
          { value: model?.apiModelId, weight: 1, allowAbbreviation: true },
          { value: model?.id, weight: 1, allowAbbreviation: true },
          { value: groupLabel, weight: 2, allowPinyin: true }
        ])
      : 0
    if (score === null) continue
    const entry = { key: model ? `model:${model.id}` : 'follow-cli', model, label, score }
    if (!gateway) {
      official.entries.push(entry)
      continue
    }
    const key = `provider:${model.providerId ?? groupLabel}`
    const group = providers.get(key)
    if (group) group.entries.push(entry)
    else providers.set(key, { key, label: groupLabel, entries: [entry] })
  }
  const groups = [...providers.values()].sort((a, b) => a.label.localeCompare(b.label))
  if (official.entries.length) groups.unshift(official)
  if (query) {
    for (const group of groups) group.entries.sort((a, b) => a.score - b.score)
  }
  return groups
}
