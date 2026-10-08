import type { McpServer } from '@shared/data/types/mcpServer'

import { hasInMemoryImplementation } from './servers/factory'

export function mcpTransportKind(server: McpServer): 'inMemory' | 'url' | 'stdio' | 'invalid' {
  if (server.type === 'inMemory' && hasInMemoryImplementation(server.name)) return 'inMemory'
  if (server.baseUrl) return 'url'
  if (server.command) return 'stdio'
  return 'invalid'
}
