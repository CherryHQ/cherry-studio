import * as z from 'zod'

import type { AgentCatalogPreset } from '@renderer/types/marketplace'

import { useBundledCatalog } from './useBundledCatalog'

const localizedText = z.object({ en: z.string().min(1), zh: z.string().min(1) })
const catalogSchema = z.object({
  schemaVersion: z.literal(1),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        name: localizedText,
        description: localizedText,
        avatar: z.string().min(1),
        category: z.string().min(1),
        instructions: z.string().min(1)
      })
    )
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length, 'Duplicate template IDs')
})

async function loadAgentCatalog(resourcesPath: string): Promise<AgentCatalogPreset[]> {
  const content = await window.api.fs.read(resourcesPath + '/data/marketplace-agents.json', 'utf-8')
  return catalogSchema.parse(JSON.parse(content)).items
}

export function useAgentCatalogPresets({ enabled = true }: { enabled?: boolean } = {}) {
  return useBundledCatalog({ catalog: 'agent templates', enabled, load: loadAgentCatalog })
}
