import { loggerService } from '@logger'
import { ComposerPanelSymbol } from '@renderer/components/composer/quickPanel'
import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import { defineTool, type ToolRenderContext, TopicType } from '@renderer/components/composer/tools/types'
import { McpLogo } from '@renderer/components/icons/SvgIcon'
import { type QuickPanelCallBackOptions, type QuickPanelListItem, useQuickPanel } from '@renderer/components/QuickPanel'
import { useAgent } from '@renderer/hooks/agent/useAgent'
import { useScopedMcpServers } from '@renderer/hooks/useMcpServer'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { DEFAULT_MCP_MODE } from '@shared/data/types/assistant'
import type { McpPrompt } from '@shared/types/mcp'
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

export const MCP_PROMPTS_LAUNCHER_ID = 'mcp-prompts'

const logger = loggerService.withContext('mcpPromptTool')

type McpPromptToolContext = ToolRenderContext<readonly [], readonly ['onTextChange']>

/**
 * Declared arguments become literal `${name}` values, so the server renders its template around
 * markers the composer then turns into Tab-fillable chips (`tokenizePromptVariablesInEditor` runs on
 * every editor update).
 *
 * ponytail: a prompt whose arguments drive a *fetch* rather than fill a template renders against the
 * literal `${name}` string. Resolving `getPrompt` at send time from the filled chips is the upgrade
 * path if that turns out to matter.
 */
export function buildMcpPromptPlaceholderArgs(
  prompt: Pick<McpPrompt, 'arguments'>
): Record<string, string> | undefined {
  const args = prompt.arguments ?? []
  if (args.length === 0) return undefined
  return Object.fromEntries(args.map((argument) => [argument.name, `\${${argument.name}}`]))
}

/** Text parts of a `prompts/get` result, in order. Image / resource parts have no composer form. */
export function flattenMcpPromptMessages(result: unknown): string {
  const messages = (result as { messages?: Array<{ content?: { type?: string; text?: string } }> })?.messages
  if (!Array.isArray(messages)) return ''
  return messages
    .map((message) => (message?.content?.type === 'text' ? (message.content.text ?? '') : ''))
    .filter(Boolean)
    .join('\n\n')
}

const McpPromptComposerRuntime = ({ context }: { context: McpPromptToolContext }) => {
  const { actions, assistant, launcher, scope, session, t } = context
  const { isVisible, symbol, updateList } = useQuickPanel()
  const [dataRequested, setDataRequested] = useState(false)
  const [prompts, setPrompts] = useState<McpPrompt[]>([])
  const [isLoadingPrompts, setIsLoadingPrompts] = useState(false)

  const { agent } = useAgent(dataRequested && scope === TopicType.Session ? (session?.agentId ?? null) : null)
  const boundServerIds = useMemo<readonly string[] | 'all' | null>(() => {
    if (scope === TopicType.Session) return agent?.mcps ?? []
    const mode = assistant ? (assistant.settings?.mcpMode ?? DEFAULT_MCP_MODE) : 'disabled'
    if (mode === 'disabled') return null
    return mode === 'auto' ? 'all' : (assistant?.mcpServerIds ?? [])
  }, [agent?.mcps, assistant, scope])
  const { servers } = useScopedMcpServers(boundServerIds, { enabled: dataRequested })

  useEffect(() => {
    if (!dataRequested) return
    if (servers.length === 0) {
      setPrompts([])
      return
    }

    let cancelled = false
    setIsLoadingPrompts(true)
    void (async () => {
      const results = await Promise.allSettled(
        servers.map((server) => ipcApi.request('mcp.server.list_prompts', { serverId: server.id }))
      )
      if (cancelled) return
      setPrompts(
        results.flatMap((result, index) => {
          if (result.status === 'fulfilled') return (result.value as McpPrompt[] | undefined) ?? []
          logger.warn('Failed to list MCP prompts', { serverId: servers[index].id, error: result.reason })
          return []
        })
      )
      setIsLoadingPrompts(false)
    })()

    return () => {
      cancelled = true
    }
  }, [dataRequested, servers])

  const insertText = useCallback(
    (text: string, options?: QuickPanelCallBackOptions) => {
      const inputAdapter = options?.inputAdapter
      if (inputAdapter) {
        inputAdapter.insertText(text)
        inputAdapter.focus()
        return
      }
      actions.onTextChange?.((prev) => `${prev}${text}`)
    },
    [actions]
  )

  const handleSelect = useCallback(
    async (prompt: McpPrompt, options?: QuickPanelCallBackOptions) => {
      try {
        const result = await ipcApi.request('mcp.server.get_prompt', {
          serverId: prompt.serverId,
          name: prompt.name,
          args: buildMcpPromptPlaceholderArgs(prompt)
        })
        const text = flattenMcpPromptMessages(result)
        if (!text) {
          toast.error(t('chat.input.mcp_prompts.empty'))
          return
        }
        insertText(text, options)
      } catch (error) {
        logger.error('Failed to get MCP prompt', error as Error, { serverId: prompt.serverId, name: prompt.name })
        toast.error(formatErrorMessageWithPrefix(error, t('chat.input.mcp_prompts.insert_failed')))
      }
    },
    [insertText, t]
  )

  const items = useMemo<QuickPanelListItem[]>(() => {
    if (!dataRequested || isLoadingPrompts) {
      return [
        {
          id: 'mcp-prompts:loading',
          label: t('common.loading'),
          icon: <Loader2 className="animate-spin" aria-hidden />,
          disabled: true
        }
      ]
    }

    if (prompts.length === 0) {
      return [
        {
          id: 'mcp-prompts:empty',
          label: t('chat.input.mcp_prompts.empty'),
          icon: <McpLogo aria-hidden />,
          disabled: true
        }
      ]
    }

    return prompts.map((prompt) => ({
      id: `mcp-prompt:${prompt.serverId}:${prompt.name}`,
      label: prompt.name,
      description: prompt.description || prompt.serverName,
      filterText: [prompt.name, prompt.description, prompt.serverName].filter(Boolean).join(' '),
      icon: <McpLogo aria-hidden />,
      suffix: prompt.serverName,
      action: (options: QuickPanelCallBackOptions) => void handleSelect(prompt, options)
    }))
  }, [dataRequested, handleSelect, isLoadingPrompts, prompts, t])

  const promptLauncher = useMemo<ComposerToolLauncher>(
    () => ({
      id: MCP_PROMPTS_LAUNCHER_ID,
      kind: 'panel',
      sources: ['root-panel'],
      order: 51,
      label: t('chat.input.mcp_prompts.title'),
      description: t('chat.input.mcp_prompts.description'),
      icon: <McpLogo aria-hidden />,
      action: ({ parentPanel, queryAnchor, quickPanel, triggerInfo }) => {
        setDataRequested(true)
        quickPanel.open({
          title: t('chat.input.mcp_prompts.title'),
          list: items,
          symbol: ComposerPanelSymbol.McpPrompts,
          parentPanel,
          queryAnchor,
          triggerInfo: triggerInfo ?? { type: 'button' }
        })
      }
    }),
    [items, t]
  )

  useEffect(() => launcher.registerLaunchers([promptLauncher]), [launcher, promptLauncher])

  useEffect(() => {
    if (!isVisible || symbol !== ComposerPanelSymbol.McpPrompts) return
    updateList(items)
  }, [isVisible, items, symbol, updateList])

  return null
}

/**
 * MCP Prompt Tool
 *
 * Root-panel entry listing the prompts published by the conversation's MCP servers. Picking one
 * renders it server-side and inserts the text; declared arguments arrive as `${name}` chips the user
 * fills with Tab.
 */
const mcpPromptTool = defineTool({
  key: 'mcp_prompts',
  label: (t) => t('chat.input.mcp_prompts.title'),
  visibleInScopes: [TopicType.Chat, TopicType.Session],

  dependencies: {
    actions: ['onTextChange'] as const
  },

  composer: {
    runtime: ({ context }) => <McpPromptComposerRuntime context={context} />
  }
})

export default mcpPromptTool
