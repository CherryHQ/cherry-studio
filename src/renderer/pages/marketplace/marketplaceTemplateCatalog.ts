import { groupTranslations } from '@renderer/components/resourceCatalog/catalog'
import type { AssistantCatalogPreset } from '@renderer/hooks/useAssistantCatalogPresets'
import type { AgentCatalogPreset, MarketplaceTemplate } from '@renderer/types/marketplace'
import { localizeMarketplaceText } from '@shared/utils/cherrySkillMarketplace'

function canonicalGroup(group: string): string {
  return (
    Object.entries(groupTranslations).find(
      ([key, labels]) => key === group || Object.values(labels).includes(group)
    )?.[0] ?? group
  )
}

export function buildMarketplaceTemplates(
  agents: AgentCatalogPreset[],
  assistants: AssistantCatalogPreset[],
  language: string
): MarketplaceTemplate[] {
  return [
    ...agents.map((item) => ({
      id: 'agent:' + item.id,
      name: localizeMarketplaceText(item.name, language),
      description: localizeMarketplaceText(item.description, language),
      avatar: item.avatar,
      prompt: item.instructions,
      groups: [canonicalGroup(item.category)]
    })),
    ...assistants.map((item) => ({
      id: 'assistant:' + item.id,
      name: item.name,
      description: item.description ?? '',
      avatar: item.emoji || '💬',
      prompt: item.prompt ?? '',
      groups: [...new Set((item.group ?? []).map(canonicalGroup))]
    }))
  ]
}
