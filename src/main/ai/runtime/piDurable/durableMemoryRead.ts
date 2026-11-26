import path from 'node:path'

import type { createReadTool } from '@earendil-works/pi-durable/tools'

import { application } from '@application'
import { agentMemoryAuthority } from '@main/ai/memory/memoryAuthority'
import { MEMORY_MAX_BYTES, MEMORY_TOPICS } from '@main/ai/memory/memoryFiles'
import { agentMemoryTurn } from '@main/ai/memory/memoryPrompt'

type ReadTool = ReturnType<typeof createReadTool>

export function withPrivateMemoryRead(
  nativeRead: ReadTool,
  sessionId: string,
  agentId: string,
  agentDataPath: string,
  canRead: (conversationId: number) => boolean,
  contextId?: string
): ReadTool {
  return {
    ...nativeRead,
    description: `${nativeRead.description} For a private memory topic, resolve the link relative to the memory entry and read its absolute path without offset or limit.`,
    async execute(args, api, context) {
      if (
        !path.isAbsolute(args.path) ||
        path.relative(path.join(agentDataPath, MEMORY_TOPICS), path.dirname(args.path))
      )
        return nativeRead.execute(args, api, context)

      const turn = agentMemoryTurn(
        () => application.get('AgentSessionRuntimeService').getInteractionState(sessionId, contextId),
        context.abortSignal
      )
      const authority = agentMemoryAuthority(sessionId, 'private', {
        ...turn,
        assertActive: () => {
          if (!canRead(api.conversationId)) throw new Error('Private memory is unavailable for this conversation')
          return turn.assertActive()
        }
      })
      if (authority.scope.kind !== 'private' || authority.scope.agentId !== agentId)
        throw new Error('Agent memory owner changed')
      if (args.offset !== undefined || args.limit !== undefined)
        throw new Error('Read the complete private memory topic')
      const session = application.get('MemoryService').open(authority)
      try {
        const { content } = await session.read(`${MEMORY_TOPICS}/${path.basename(args.path)}`)
        if (content === null || Buffer.byteLength(content) > MEMORY_MAX_BYTES)
          throw new Error('Private topic unavailable')
        await session.validateModelReads()
        authority.assertAuthorized()
        return { output: [{ type: 'text', text: content }], structuredOutput: content }
      } finally {
        session.dispose()
      }
    }
  }
}
