import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useBuiltinMcpCatalog } from '@renderer/hooks/useBuiltinMcpCatalog'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import { getBuiltInMcpServerDescriptionLabelKey } from '@renderer/i18n/label'
import { permissionModeCards } from '@renderer/utils/agent'
import { fetchGenerate } from '@renderer/utils/aiGeneration'
import {
  type AutoConfigCatalogs,
  type AutoConfigKind,
  type AutoConfigDraft,
  buildAutoConfigInput,
  getFeaturedMcpName,
  parseAutoConfigDraft,
  readAutoConfigProgress,
  RESOURCE_AUTO_CONFIG_SYSTEM_PROMPT,
  toFeaturedMcpId
} from '@renderer/utils/resourceCatalog'
import type { AgentType } from '@shared/data/types/agent'
import { isBrowserMcpServer } from '@shared/utils/mcp'

/** What a streaming auto create has produced so far, named for display. */
export type AutoConfigProgressView = {
  prompt: string
  promptDone: boolean
  /** MCP servers and the permission mode (Agent) or web search (Assistant) picked so far. */
  tools: { done: boolean; picks: string[] }
  /** Agent only. */
  skills: { done: boolean; picks: string[] }
}

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
      onProgress?: (progress: AutoConfigProgressView) => void
    }): Promise<AutoConfigDraft | null> => {
      const { onProgress, ...input } = request
      const nameOf = (items: { id: string; name: string }[], ids: string[]) =>
        ids.flatMap((id) => items.find((item) => item.id === id)?.name ?? [])
      let streamed = ''
      const text = await fetchGenerate({
        prompt: RESOURCE_AUTO_CONFIG_SYSTEM_PROMPT,
        content: buildAutoConfigInput({ kind, catalogs, ...input }),
        throwOnError: true,
        signal,
        onTextDelta: onProgress
          ? (delta) => {
              streamed += delta
              const { prompt, promptDone, tools, skills } = readAutoConfigProgress(streamed, kind)
              const permission = permissionModeCards.find((card) => card.mode === tools.permissionMode)
              onProgress({
                prompt,
                promptDone,
                tools: {
                  done: tools.done,
                  picks: [
                    ...nameOf(catalogs.mcpServers, tools.mcpServerIds),
                    ...(permission ? [t(permission.titleKey)] : []),
                    ...(tools.enableWebSearch ? [t('library.config.dialogs.create.result.web_search')] : [])
                  ]
                },
                skills: { done: skills.done, picks: nameOf(catalogs.skills, skills.skillIds) }
              })
            }
          : undefined
      })
      return parseAutoConfigDraft(text, { kind, agentType: input.agentType, catalogs })
    },
    [catalogs, kind, t]
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
