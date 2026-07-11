import { Compass } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useOptionalMessageListActions } from '../../MessageListProvider'

interface NavigateToolInput {
  path?: string
  query?: Record<string, string>
}

const ROUTE_LABELS: Record<string, { icon: string; labelKey: string }> = {
  // Top-level pages
  '/app/chat': { icon: '💬', labelKey: 'agent.session.group.conversation' },
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
  '/settings/provider': { icon: '🔑', labelKey: 'settings.provider.title' },
  '/settings/model': { icon: '🤖', labelKey: 'settings.model' },
  '/settings/appearance': { icon: '🎨', labelKey: 'settings.appearance.title' },
  '/settings/notifications': { icon: '🔔', labelKey: 'settings.notification.title' },
  '/settings/system': { icon: '⚙️', labelKey: 'settings.system.title' },
  '/settings/data': { icon: '💾', labelKey: 'settings.data.title' },
  '/settings/mcp': { icon: '🔌', labelKey: 'agent.settings.toolsMcp.mcp.tab' },
  '/settings/websearch': { icon: '🔍', labelKey: 'settings.tool.websearch.title' },
  '/settings/api-gateway': { icon: '🌐', labelKey: 'apiGateway.title' },
  '/settings/file-processing': { icon: '📄', labelKey: 'settings.tool.file_processing.title' },
  '/settings/shortcut': { icon: '⌨️', labelKey: 'settings.shortcuts.title' },
  '/settings/quick-assistant': { icon: '🪟', labelKey: 'settings.quickAssistant.title' },
  '/settings/selection-assistant': { icon: '✂️', labelKey: 'selection.name' },
  '/settings/about': { icon: 'ℹ️', labelKey: 'settings.about.label' },

  // MCP sub-pages
  '/settings/mcp/servers': { icon: '📋', labelKey: 'settings.mcp.title' },
  '/settings/mcp/builtin': { icon: '📦', labelKey: 'settings.mcp.builtinServers' },
  '/settings/mcp/marketplaces': { icon: '🛒', labelKey: 'settings.mcp.marketplaces' },
  '/settings/mcp/npx-search': { icon: '🔍', labelKey: 'settings.mcp.searchNpx' },
  '/settings/mcp/mcp-install': { icon: '📥', labelKey: 'settings.mcp.install' },
  '/settings/mcp/settings': { icon: '⚙️', labelKey: 'settings.mcp.system' }
}

// Sorted by path length descending for longest prefix match
const SORTED_ROUTES = Object.entries(ROUTE_LABELS).sort((a, b) => b[0].length - a[0].length)

function getRouteInfo(path: string): { icon: string; labelKey?: string; label?: string } {
  // Exact match first
  if (ROUTE_LABELS[path]) return ROUTE_LABELS[path]

  // Strip query string for matching
  const cleanPath = path.split('?')[0]
  if (ROUTE_LABELS[cleanPath]) return ROUTE_LABELS[cleanPath]

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
export function NavigateToolInline({
  input,
  output
}: {
  input?: NavigateToolInput | Record<string, unknown>
  output?: unknown
}) {
  const typedInput = input as NavigateToolInput | undefined
  const basePath = typedInput?.path ?? ''
  const queryObj = typedInput?.query

  // Build full path with query params
  let fullPath = basePath
  if (queryObj && typeof queryObj === 'object' && Object.keys(queryObj).length > 0) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(queryObj)) {
      if (typeof value === 'string') {
        params.set(key, value)
      }
    }
    const qs = params.toString()
    if (qs) {
      fullPath = `${basePath}?${qs}`
    }
  }

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
  const isSuccess = outputText.includes('Navigated to')

  const navigateToRoute = useOptionalMessageListActions()?.navigateToRoute

  const handleClick = () => {
    if (!basePath || !navigateToRoute) return
    void navigateToRoute({ path: basePath, query: queryObj })
  }

  return (
    <button
      onClick={handleClick}
      disabled={!basePath || !navigateToRoute}
      className="my-1 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border border-solid bg-muted px-3 py-1.5 text-foreground text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-muted"
      type="button">
      <Compass className="h-3.5 w-3.5 opacity-60" />
      <span>
        {routeInfo.icon} {routeInfo.labelKey ? t(routeInfo.labelKey) : routeInfo.label}
      </span>
      {isSuccess && <span className="text-green-500">✓</span>}
    </button>
  )
}
