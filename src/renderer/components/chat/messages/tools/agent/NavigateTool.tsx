export { isKnownNavigationPath } from '@shared/utils/navigationPath'

import { Compass } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { useOptionalMessageListActions } from '../../MessageListProvider'

const navigationInputSchema = z.object({
  path: z.string(),
  query: z.unknown().optional()
})

const ROUTE_LABELS = new Map(
  Object.entries({
    // Top-level pages
    '/app/chat': { icon: '💬', labelKey: 'agent.session.group.conversation' },
    '/app/scheduled-tasks': { icon: '⏰', labelKey: 'settings.scheduledTasks.title' },
    '/app/paintings': { icon: '🎨', labelKey: 'title.paintings' },
    '/app/translate': { icon: '🌐', labelKey: 'title.translate' },
    '/app/files': { icon: '📁', labelKey: 'title.files' },
    '/app/notes': { icon: '📝', labelKey: 'title.notes' },
    '/app/knowledge': { icon: '📚', labelKey: 'title.knowledge' },
    '/app/mini-app': { icon: '📦', labelKey: 'title.apps' },
    '/app/code': { icon: '💻', labelKey: 'title.code' },
    '/app/launchpad': { icon: '🚀', labelKey: 'title.launchpad' },
    '/app/agents': { icon: '🤖', labelKey: 'agent.sidebar_title' },

    // Settings pages
    '/settings/general': { icon: '⚙️', labelKey: 'settings.general.common.title' },
    '/settings/provider': { icon: '🔑', labelKey: 'settings.provider.title' },
    '/settings/model': { icon: '🤖', labelKey: 'settings.model' },
    '/settings/local-models': { icon: '📦', labelKey: 'settings.dependencies.localModels.title' },
    '/settings/appearance': { icon: '🎨', labelKey: 'settings.appearance.title' },
    '/settings/notifications': { icon: '🔔', labelKey: 'settings.notification.title' },
    '/settings/data': { icon: '💾', labelKey: 'settings.data.title' },
    '/settings/mcp': { icon: '🔌', labelKey: 'agent.settings.toolsMcp.mcp.tab' },
    '/settings/websearch': { icon: '🔍', labelKey: 'settings.tool.websearch.title' },
    '/settings/api-gateway': { icon: '🌐', labelKey: 'apiGateway.title' },
    '/settings/device-connections': { icon: '📱', labelKey: 'deviceConnections.title' },
    '/settings/file-processing': {
      icon: '📄',
      labelKey: 'settings.tool.file_processing.features.document_to_markdown.title'
    },
    '/settings/ocr': { icon: '🔤', labelKey: 'settings.tool.file_processing.features.image_to_text.title' },
    '/settings/shortcut': { icon: '⌨️', labelKey: 'settings.shortcuts.title' },
    '/settings/quick-assistant': { icon: '🪟', labelKey: 'settings.quickAssistant.title' },
    '/settings/selection-assistant': { icon: '✂️', labelKey: 'selection.name' },
    '/settings/about': { icon: 'ℹ️', labelKey: 'settings.about.label' },
    '/settings/channels': { icon: '📡', labelKey: 'settings.channels.title' },
    '/settings/code-execution': { icon: '⚙️', labelKey: 'chat.settings.code_execution.title' },
    '/settings/dependencies': { icon: '🛠️', labelKey: 'settings.dependencies.title' },
    '/settings/skills': { icon: '🧰', labelKey: 'settings.skills.title' },
    '/settings/usage': { icon: '📊', labelKey: 'settings.usage.title' },
    '/settings/profile': { icon: '👤', labelKey: 'settings.profile.title' },

    // MCP sub-pages
    '/settings/mcp/servers': { icon: '📋', labelKey: 'settings.mcp.title' },
    '/settings/mcp/builtin': { icon: '📦', labelKey: 'settings.mcp.builtinServers' },
    '/settings/mcp/marketplaces': { icon: '🛒', labelKey: 'settings.mcp.marketplaces' },
    '/settings/mcp/npx-search': { icon: '🔍', labelKey: 'settings.mcp.searchNpx' },
    '/settings/mcp/mcp-install': { icon: '📥', labelKey: 'settings.mcp.install' },
    '/settings/mcp/settings': { icon: '⚙️', labelKey: 'settings.mcp.system' }
  })
)

// Sorted by path length descending for longest prefix match
const SORTED_ROUTES = [...ROUTE_LABELS].sort((a, b) => b[0].length - a[0].length)

function getRouteInfo(path: string) {
  // Exact match first
  const exact = ROUTE_LABELS.get(path)

  if (exact) return exact

  // Strip query string for matching
  const cleanPath = path.split('?')[0]
  const clean = ROUTE_LABELS.get(cleanPath)

  if (clean) return clean

  // Longest prefix match
  for (const [route, info] of SORTED_ROUTES) {
    if (cleanPath.startsWith(route + '/') || cleanPath === route) return info
  }

  return { icon: '📍', label: path }
}

/**
 * Inline navigate button rendered directly in message content.
 * Not a Collapse item — rendered as a simple clickable button.
 */
export function NavigateToolInline({ input, output }: { input?: unknown; output?: unknown }) {
  const parsedInput = navigationInputSchema.safeParse(input)
  const basePath = parsedInput.success ? parsedInput.data.path : ''
  const rawQuery = parsedInput.success ? parsedInput.data.query : undefined

  const queryObj =
    rawQuery && typeof rawQuery === 'object'
      ? Object.fromEntries(
          Object.entries(rawQuery).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        )
      : undefined

  const qs = queryObj ? new URLSearchParams(queryObj).toString() : ''
  const fullPath = qs ? `${basePath}?${qs}` : basePath

  const routeInfo = getRouteInfo(fullPath)
  const { t } = useTranslation()

  const outputText =
    output && typeof output === 'string'
      ? output
      : Array.isArray(output)
        ? (output as Array<{ text?: string }>)
            .map((o) => o?.text)
            .filter(Boolean)
            .join('')
        : ''

  const isSuccess = outputText.includes('Navigate link created')

  const navigateToRoute = useOptionalMessageListActions()?.navigateToRoute

  const handleClick = () => {
    if (!basePath || !navigateToRoute) return
    void navigateToRoute({ path: basePath, query: queryObj })
  }

  return (
    <button
      onClick={handleClick}
      disabled={!basePath || !navigateToRoute}
      className="my-1 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-border bg-muted px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-muted"
      type="button">
      <Compass className="h-3.5 w-3.5 opacity-60" />
      <span>
        {routeInfo.icon} {'label' in routeInfo ? routeInfo.label : t(routeInfo.labelKey)}
      </span>
      {isSuccess && <span className="text-success">✓</span>}
    </button>
  )
}
