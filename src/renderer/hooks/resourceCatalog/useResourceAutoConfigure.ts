import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useBuiltinMcpCatalog } from '@renderer/hooks/useBuiltinMcpCatalog'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import { getBuiltInMcpServerDescriptionLabelKey } from '@renderer/i18n/label'
import { fetchGenerate } from '@renderer/utils/aiGeneration'
import {
  type AutoConfigCatalogs,
  type AutoConfigKind,
  type AutoConfigDraft,
  buildAutoConfigInput,
  getFeaturedMcpName,
  parseAutoConfigDraft,
  RESOURCE_AUTO_CONFIG_SYSTEM_PROMPT,
  toFeaturedMcpId
} from '@renderer/utils/resourceCatalog'
import type { AgentType } from '@shared/data/types/agent'
import { isBrowserMcpServer } from '@shared/utils/mcp'

/**
 * Runs the creator skill against what the user actually has installed, plus the featured MCP
 * servers that need no configuration. Generation uses the default model (as prompt polishing
 * does); agent-only models may not serve one-shot text.
 */
export function useResourceAutoConfigure(kind: AutoConfigKind) {
  const { t } = useTranslation()
  const { skills, loading: skillsLoading } = useInstalledSkills(undefined, { enabled: kind === 'agent' })
  const { bases, isLoading: basesLoading } = useKnowledgeBases()
  const mcpCatalog = useBuiltinMcpCatalog()
  const { mcpServers, featured, isLoading: mcpLoading } = mcpCatalog

  const catalogs = useMemo<AutoConfigCatalogs>(
    () => ({
      skills: skills
        .filter((skill) => skill.source !== 'builtin' && skill.isGlobalEnabled)
        .map(({ id, name, description }) => ({ id, name, description })),
      knowledgeBases: bases.map(({ id, name }) => ({ id, name })),
      mcpServers: [
        ...mcpServers
          .filter((server) => server.isActive && !isBrowserMcpServer(server))
          .map(({ id, name, description }) => ({ id, name, description })),
        ...featured.map((preset) => ({
          id: toFeaturedMcpId(preset.name),
          name: preset.name,
          description: t(getBuiltInMcpServerDescriptionLabelKey(preset.name))
        }))
      ]
    }),
    [bases, featured, mcpServers, skills, t]
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

  /** Installs the featured servers among `ids` and returns the IDs with their real server IDs; throws on a failed install. */
  const installFeaturedMcpServers = async (ids: string[]): Promise<string[]> => {
    const resolved: string[] = []
    for (const id of ids) {
      const name = getFeaturedMcpName(id)
      const preset = name ? mcpCatalog.presets.find((item) => item.name === name) : undefined
      resolved.push(preset ? (await mcpCatalog.installFeatured(preset)).id : id)
    }
    return resolved
  }

  return { ready: !skillsLoading && !basesLoading && !mcpLoading, generate, installFeaturedMcpServers }
}
