import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
import { isSupportedToolUse } from '@renderer/utils/assistant'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { DEFAULT_MCP_MODE } from '@shared/data/types/assistant'
import type { McpResource } from '@shared/types/mcp'

import { mcpResourceToComposerToken } from '../../variants/shared/composerTokens'

export const MCP_RESOURCES_LAUNCHER_ID = 'mcp-resources'

/**
 * Above this, a picked resource becomes a chip pointing at `mcp_resource_read` instead of raw text —
 * the model reads it on demand rather than paying for it in every turn of the conversation.
 */
export const MCP_RESOURCE_INLINE_MAX_CHARS = 4000

const logger = loggerService.withContext('mcpResourceTool')

type McpResourceToolContext = ToolRenderContext<readonly [], readonly ['onTextChange']>

const TEXT_LIKE_MIME_PATTERN = /^text\/|json|xml|yaml|markdown|csv|sql|html|javascript|typescript|x-sh/

/** A missing mimeType is treated as text: MCP servers routinely omit it for text resources. */
export function isTextLikeMcpResource(mimeType?: string): boolean {
  if (!mimeType) return true
  return TEXT_LIKE_MIME_PATTERN.test(mimeType)
}

export const McpResourceComposerRuntime = ({ context }: { context: McpResourceToolContext }) => {
  const { actions, assistant, launcher, model, scope, session, t } = context
  const { isVisible, symbol, updateList } = useQuickPanel()
  const [dataRequested, setDataRequested] = useState(false)
  const [resources, setResources] = useState<McpResource[]>([])
  const [isLoadingResources, setIsLoadingResources] = useState(false)
  // A pick fires an IPC read; the composer can unmount (or the user can pick again) before it lands,
  // and neither the insert nor the toast may run against a dead runtime.
  const isMountedRef = useRef(true)
  const selectionGenerationRef = useRef(0)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  /**
   * Which reader a deferred (reference) pick can rely on. Agent sessions read resources through the
   * MCP bridge their runtime already speaks; chat reads them with the `mcp_resource_read` builtin,
   * which only exists for a model that can call function tools. Neither is available otherwise, and
   * a reference promising a reader that is not there is worse than refusing the pick.
   */
  const resourceReader = useMemo<'runtime' | 'mcp_resource_read' | null>(() => {
    if (scope === TopicType.Session) return 'runtime'
    return isSupportedToolUse(model) ? 'mcp_resource_read' : null
  }, [model, scope])

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
      setResources([])
      return
    }

    let cancelled = false
    setIsLoadingResources(true)
    void (async () => {
      const results = await Promise.allSettled(
        servers.map((server) => ipcApi.request('mcp.server.list_resources', { serverId: server.id }))
      )
      if (cancelled) return
      setResources(
        results.flatMap((result, index) => {
          if (result.status === 'fulfilled') return (result.value as McpResource[] | undefined) ?? []
          logger.warn('Failed to list MCP resources', { serverId: servers[index].id, error: result.reason })
          return []
        })
      )
      setIsLoadingResources(false)
    })()

    return () => {
      cancelled = true
    }
  }, [dataRequested, servers])

  const insertReferenceToken = useCallback(
    (resource: McpResource, options?: QuickPanelCallBackOptions) => {
      const inputAdapter = options?.inputAdapter
      const token = mcpResourceToComposerToken(resource, { reader: resourceReader ?? 'runtime' })
      if (inputAdapter?.insertToken) {
        inputAdapter.insertToken(token)
        inputAdapter.focus()
        return
      }
      // Composers without a token-capable adapter (plain textarea) still get the sentence.
      actions.onTextChange?.((prev) => `${prev}${token.promptText ?? ''}`)
    },
    [actions, resourceReader]
  )

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
    async (resource: McpResource, options?: QuickPanelCallBackOptions) => {
      const generation = ++selectionGenerationRef.current
      try {
        // A declared binary type cannot be inlined. Insert the deferred read immediately instead of
        // downloading the blob once for classification and again when the runtime reads it.
        if (!isTextLikeMcpResource(resource.mimeType)) {
          if (!resourceReader) {
            toast.error(t('chat.input.mcp_resources.reader_unavailable'))
            return
          }
          insertReferenceToken(resource, options)
          return
        }
        // Capped main-side: only the inline budget crosses IPC, plus the metadata needed to decide
        // between inlining and attaching a reference.
        const preview = await ipcApi.request('mcp.server.read_resource_preview', {
          serverId: resource.serverId,
          uri: resource.uri,
          maxChars: MCP_RESOURCE_INLINE_MAX_CHARS
        })
        // The composer this pick targeted may be gone (topic switch, unmount) by now.
        if (!isMountedRef.current || generation !== selectionGenerationRef.current) return

        if (preview.text && preview.totalChars <= MCP_RESOURCE_INLINE_MAX_CHARS) {
          insertText(preview.text, options)
          return
        }
        // Everything else has to be read later, by a tool — which only exists when the runtime
        // exposes one. Saying so beats attaching a reference nothing in this scope can follow.
        if (!resourceReader) {
          toast.error(t('chat.input.mcp_resources.reader_unavailable'))
          return
        }
        insertReferenceToken(resource, options)
      } catch (error) {
        if (!isMountedRef.current || generation !== selectionGenerationRef.current) return
        logger.error('Failed to read MCP resource', error as Error, {
          serverId: resource.serverId,
          uri: resource.uri
        })
        toast.error(formatErrorMessageWithPrefix(error, t('chat.input.mcp_resources.read_failed')))
      }
    },
    [insertReferenceToken, insertText, resourceReader, t]
  )

  const items = useMemo<QuickPanelListItem[]>(() => {
    if (!dataRequested || isLoadingResources) {
      return [
        {
          id: 'mcp-resources:loading',
          label: t('common.loading'),
          icon: <Loader2 className="animate-spin" aria-hidden />,
          disabled: true
        }
      ]
    }

    if (resources.length === 0) {
      return [
        {
          id: 'mcp-resources:empty',
          label: t('chat.input.mcp_resources.empty'),
          icon: <McpLogo aria-hidden />,
          disabled: true
        }
      ]
    }

    return resources.map((resource) => {
      const isBinary = !isTextLikeMcpResource(resource.mimeType)
      return {
        id: `mcp-resource:${resource.serverId}:${resource.uri}`,
        label: resource.name || resource.uri,
        description: resource.description || (isBinary ? resource.mimeType : undefined) || resource.uri,
        filterText: [resource.name, resource.uri, resource.description, resource.serverName].filter(Boolean).join(' '),
        icon: <McpLogo aria-hidden />,
        suffix: resource.serverName,
        action: (options: QuickPanelCallBackOptions) => void handleSelect(resource, options)
      }
    })
  }, [dataRequested, handleSelect, isLoadingResources, resources, t])

  const resourceLauncher = useMemo<ComposerToolLauncher>(
    () => ({
      id: MCP_RESOURCES_LAUNCHER_ID,
      kind: 'panel',
      sources: ['root-panel'],
      order: 52,
      label: t('chat.input.mcp_resources.title'),
      description: t('chat.input.mcp_resources.description'),
      icon: <McpLogo aria-hidden />,
      action: ({ parentPanel, queryAnchor, quickPanel, triggerInfo }) => {
        setDataRequested(true)
        quickPanel.open({
          title: t('chat.input.mcp_resources.title'),
          list: items,
          symbol: ComposerPanelSymbol.McpResources,
          parentPanel,
          queryAnchor,
          triggerInfo: triggerInfo ?? { type: 'button' }
        })
      }
    }),
    [items, t]
  )

  useEffect(() => launcher.registerLaunchers([resourceLauncher]), [launcher, resourceLauncher])

  useEffect(() => {
    if (!isVisible || symbol !== ComposerPanelSymbol.McpResources) return
    updateList(items)
  }, [isVisible, items, symbol, updateList])

  return null
}

/**
 * MCP Resource Tool
 *
 * Root-panel entry listing the resources published by the conversation's MCP servers. Small text
 * resources are inlined into the composer; binary or oversized ones become a chip whose sentence
 * points the model at `mcp_resource_read`.
 */
const mcpResourceTool = defineTool({
  key: 'mcp_resources',
  label: (t) => t('chat.input.mcp_resources.title'),
  visibleInScopes: [TopicType.Chat, TopicType.Session],

  dependencies: {
    actions: ['onTextChange'] as const
  },

  composer: {
    runtime: ({ context }) => <McpResourceComposerRuntime context={context} />
  }
})

export default mcpResourceTool
