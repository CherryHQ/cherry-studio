import { dataApiService } from '@renderer/data/DataApiService'
import { AGENTS_MAX_LIMIT, type AgentEntity } from '@shared/data/api/schemas/agents'

/** Read the complete server-side search result, not the picker's first-page cache. */
export async function findAgentByName(name: string): Promise<AgentEntity | undefined> {
  for (let page = 1; ; page++) {
    const result = await dataApiService.get('/agents', { query: { search: name, page, limit: AGENTS_MAX_LIMIT } })
    const match = result.items.find((agent) => agent.name === name)
    if (match) return match
    if (page * AGENTS_MAX_LIMIT >= result.total) return undefined
    if (result.items.length === 0) throw new Error('Incomplete agent lookup')
  }
}
