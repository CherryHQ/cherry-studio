import { loggerService } from '@logger'
import { createPromptVariableToken } from '@renderer/components/composer/promptVariables'
import { ComposerPanelSymbol } from '@renderer/components/composer/quickPanel'
import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import { defineTool, type ToolRenderContext, TopicType } from '@renderer/components/composer/tools/types'
import { McpLogo } from '@renderer/components/icons/SvgIcon'
import {
  type QuickPanelCallBackOptions,
  type QuickPanelInputAdapter,
  type QuickPanelListItem,
  useQuickPanel
} from '@renderer/components/QuickPanel'
import { useAgent } from '@renderer/hooks/agent/useAgent'
import { useScopedMcpServers } from '@renderer/hooks/useMcpServer'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { DEFAULT_MCP_MODE } from '@shared/data/types/assistant'
import type { McpPrompt } from '@shared/types/mcp'
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export const MCP_PROMPTS_LAUNCHER_ID = 'mcp-prompts'

const logger = loggerService.withContext('mcpPromptTool')

type McpPromptToolContext = ToolRenderContext<readonly [], readonly ['onTextChange']>

/**
 * Marker handed to the server in place of a value the user has not typed yet, so the rendered
 * template comes back with an exact, findable hole per argument.
 *
 * Per-insertion nonce and a delimiter no template language uses, rather than `${name}`: the marker
 * has to be distinguishable from `${...}` the server itself emits (a shell `${HOME}`, a GitHub
 * Actions expression), which must stay literal text rather than turn into an editable field.
 */
const buildMcpPromptArgSentinel = (nonce: string, name: string) => `«cs-arg:${nonce}:${name}»`

const mcpPromptArgSentinelPattern = (nonce: string) => new RegExp(`«cs-arg:${nonce}:([^»]+)»`, 'g')

export function createMcpPromptNonce(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8)
}

/**
 * Sentinels for *required* arguments only.
 *
 * An optional argument is omitted, never sent as a marker: MCP's contract is that omitting it lets
 * the server apply its own default, so sending a placeholder string would overwrite that default
 * (and, for an argument the server queries with, send it looking for a row named after the marker).
 */
export function buildMcpPromptPlaceholderArgs(
  prompt: Pick<McpPrompt, 'arguments'>,
  nonce: string
): Record<string, string> | undefined {
  const required = (prompt.arguments ?? []).filter((argument) => argument.required)
  if (required.length === 0) return undefined
  return Object.fromEntries(
    required.map((argument) => [argument.name, buildMcpPromptArgSentinel(nonce, argument.name)])
  )
}

export type McpPromptSegment = { type: 'text'; value: string } | { type: 'argument'; name: string }

/**
 * Split the rendered prompt into literal text and the argument holes this insertion asked for.
 * Only sentinels carrying this insertion's nonce become fields; everything else, including any
 * `${...}` the server wrote, stays text.
 */
export function splitMcpPromptText(text: string, nonce: string): McpPromptSegment[] {
  const segments: McpPromptSegment[] = []
  const pattern = mcpPromptArgSentinelPattern(nonce)
  let cursor = 0

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) segments.push({ type: 'text', value: text.slice(cursor, index) })
    segments.push({ type: 'argument', name: match[1] })
    cursor = index + match[0].length
  }

  if (cursor < text.length) segments.push({ type: 'text', value: text.slice(cursor) })
  return segments
}

/** Plain-text rendering for composers with no token-capable adapter. */
export function renderMcpPromptSegmentsAsText(segments: readonly McpPromptSegment[]): string {
  return segments.map((segment) => (segment.type === 'text' ? segment.value : `\${${segment.name}}`)).join('')
}

/**
 * Write a rendered prompt into the composer: one chip per argument this insertion declared, and the
 * body as literal text with variable tokenization off — so a `${HOME}` the server itself wrote stays
 * text instead of becoming a field the user can silently overwrite.
 *
 * Chips carry `insertSeparator: false`: the surrounding text is the server's, reproduced verbatim,
 * so an appended space would rewrite `Hello ${name}!` into `Hello ${name} !`.
 */
export function insertMcpPromptSegments(
  segments: readonly McpPromptSegment[],
  inputAdapter: QuickPanelInputAdapter
): void {
  segments.forEach((segment, index) => {
    if (segment.type === 'text') {
      inputAdapter.insertText(segment.value, { tokenizeVariables: false })
      return
    }
    inputAdapter.insertToken?.(createPromptVariableToken(segment.name, `\${${segment.name}}`, index), {
      insertSeparator: false
    })
  })
  inputAdapter.focus()
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
  // A pick fires an IPC round trip; the composer can unmount (or the user can pick again) before it
  // lands, and neither the insert nor the toast may run against a dead runtime.
  const isMountedRef = useRef(true)
  const selectionGenerationRef = useRef(0)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

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

  const insertSegments = useCallback(
    (segments: readonly McpPromptSegment[], options?: QuickPanelCallBackOptions) => {
      const inputAdapter = options?.inputAdapter
      if (!inputAdapter?.insertToken) {
        const text = renderMcpPromptSegmentsAsText(segments)
        if (inputAdapter) {
          inputAdapter.insertText(text)
          inputAdapter.focus()
          return
        }
        actions.onTextChange?.((prev) => `${prev}${text}`)
        return
      }

      insertMcpPromptSegments(segments, inputAdapter)
    },
    [actions]
  )

  const handleSelect = useCallback(
    async (prompt: McpPrompt, options?: QuickPanelCallBackOptions) => {
      const generation = ++selectionGenerationRef.current
      const nonce = createMcpPromptNonce()
      try {
        const result = await ipcApi.request('mcp.server.get_prompt', {
          serverId: prompt.serverId,
          name: prompt.name,
          args: buildMcpPromptPlaceholderArgs(prompt, nonce)
        })
        // The composer this insertion targeted may be gone (topic switch, unmount) by now.
        if (!isMountedRef.current || generation !== selectionGenerationRef.current) return
        const text = flattenMcpPromptMessages(result)
        if (!text) {
          toast.error(t('chat.input.mcp_prompts.empty'))
          return
        }
        insertSegments(splitMcpPromptText(text, nonce), options)
      } catch (error) {
        if (!isMountedRef.current || generation !== selectionGenerationRef.current) return
        logger.error('Failed to get MCP prompt', error as Error, { serverId: prompt.serverId, name: prompt.name })
        toast.error(formatErrorMessageWithPrefix(error, t('chat.input.mcp_prompts.insert_failed')))
      }
    },
    [insertSegments, t]
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
