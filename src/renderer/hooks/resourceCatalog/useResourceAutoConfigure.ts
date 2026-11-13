import { useCallback, useMemo } from 'react'

import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'
import { useMcpServers } from '@renderer/hooks/useMcpServer'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import { fetchGenerate } from '@renderer/utils/aiGeneration'
import {
  type AutoConfigCatalogs,
  type AutoConfigDraft,
  buildAutoConfigInput,
  parseAutoConfigDraft,
  RESOURCE_AUTO_CONFIG_SYSTEM_PROMPT
} from '@renderer/utils/resourceCatalog'
import type { AgentType } from '@shared/data/types/agent'
import { isBrowserMcpServer } from '@shared/utils/mcp'

/**
 * Runs the creator skill against what the user actually has installed. Generation uses the
 * default model (as prompt polishing does); agent-only models may not serve one-shot text.
 */
export function useResourceAutoConfigure(kind: 'assistant' | 'agent', enabled: boolean) {
  const { skills, loading: skillsLoading } = useInstalledSkills(undefined, { enabled: enabled && kind === 'agent' })
  const { bases, isLoading: basesLoading } = useKnowledgeBases({ enabled })
  const { mcpServers, isLoading: mcpLoading } = useMcpServers(undefined, { enabled })

  const catalogs = useMemo<AutoConfigCatalogs>(
    () => ({
      skills: skills
        .filter((skill) => skill.source !== 'builtin' && skill.isGlobalEnabled)
        .map(({ id, name, description }) => ({ id, name, description })),
      knowledgeBases: bases.map(({ id, name }) => ({ id, name })),
      mcpServers: mcpServers
        .filter((server) => server.isActive && !isBrowserMcpServer(server))
        .map(({ id, name, description }) => ({ id, name, description }))
    }),
    [bases, mcpServers, skills]
  )

  const generate = useCallback(
    async ({
      signal,
      ...request
    }: {
      agentType: AgentType
      purpose: string
      name: string
      signal: AbortSignal
    }): Promise<AutoConfigDraft | null> => {
      const text = await fetchGenerate({
        prompt: RESOURCE_AUTO_CONFIG_SYSTEM_PROMPT,
        content: buildAutoConfigInput({ kind, catalogs, ...request }),
        throwOnError: true,
        signal
      })
      return parseAutoConfigDraft(text, { kind, agentType: request.agentType, catalogs })
    },
    [catalogs, kind]
  )

  return { ready: !skillsLoading && !basesLoading && !mcpLoading, generate }
}
