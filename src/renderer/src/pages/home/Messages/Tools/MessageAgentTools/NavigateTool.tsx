import { Compass } from 'lucide-react'

interface NavigateToolInput {
  path?: string
  query?: Record<string, string>
}

const ROUTE_LABELS: Record<string, { icon: string; label: string }> = {
  // Top-level pages
  '/': { icon: '🏠', label: 'Home' },
  '/store': { icon: '🏪', label: 'Store' },
  '/paintings': { icon: '🎨', label: 'Paintings' },
  '/translate': { icon: '🌐', label: 'Translate' },
  '/files': { icon: '📁', label: 'Files' },
  '/notes': { icon: '📝', label: 'Notes' },
  '/knowledge': { icon: '📚', label: 'Knowledge' },
  '/apps': { icon: '📦', label: 'Mini Apps' },
  '/code': { icon: '💻', label: 'Code Tools' },
  '/openclaw': { icon: '🦞', label: 'OpenClaw' },
  '/launchpad': { icon: '🚀', label: 'Launchpad' },
  '/agents': { icon: '🤖', label: 'Agents' },

  // Settings pages
  '/settings/provider': { icon: '🔑', label: 'Provider' },
  '/settings/model': { icon: '🤖', label: 'Models' },
  '/settings/general': { icon: '⚙️', label: 'General' },
  '/settings/display': { icon: '🖥️', label: 'Display' },
  '/settings/data': { icon: '💾', label: 'Data' },
  '/settings/mcp': { icon: '🔌', label: 'MCP' },
  '/settings/websearch': { icon: '🔍', label: 'Web Search' },
  '/settings/memory': { icon: '🧠', label: 'Memory' },
  '/settings/api-server': { icon: '🌐', label: 'API Server' },
  '/settings/docprocess': { icon: '📄', label: 'Doc Processing' },
  '/settings/quickphrase': { icon: '⚡', label: 'Quick Phrases' },
  '/settings/shortcut': { icon: '⌨️', label: 'Shortcuts' },
  '/settings/quickAssistant': { icon: '🪟', label: 'Quick Assistant' },
  '/settings/selectionAssistant': { icon: '✂️', label: 'Selection Assistant' },
  '/settings/about': { icon: 'ℹ️', label: 'About' },

  // MCP sub-pages
  '/settings/mcp/servers': { icon: '📋', label: 'MCP Servers' },
  '/settings/mcp/builtin': { icon: '📦', label: 'Built-in MCP' },
  '/settings/mcp/marketplaces': { icon: '🛒', label: 'MCP Market' },
  '/settings/mcp/npx-search': { icon: '🔍', label: 'NPX Search' },
  '/settings/mcp/mcp-install': { icon: '📥', label: 'Install MCP' },
  '/settings/mcp/settings': { icon: '⚙️', label: 'MCP Settings' },

  // Web Search sub-pages
  '/settings/websearch/general': { icon: '🔍', label: 'Search Settings' },
  '/settings/websearch/provider': { icon: '🔍', label: 'Search Provider' }
}

// Sorted by path length descending for longest prefix match
const SORTED_ROUTES = Object.entries(ROUTE_LABELS).sort((a, b) => b[0].length - a[0].length)

function getRouteInfo(path: string): { icon: string; label: string } {
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

  const handleClick = () => {
    if (typeof window.navigate === 'function') {
      window.navigate(fullPath)
    }
  }

  return (
    <button
      onClick={handleClick}
      className="my-1 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--color-border)] border-solid bg-[var(--color-background-soft)] px-3 py-1.5 text-[var(--color-text-1)] text-sm transition-colors hover:bg-[var(--color-background-mute)]"
      type="button">
      <Compass className="h-3.5 w-3.5 opacity-60" />
      <span>
        {routeInfo.icon} {routeInfo.label}
      </span>
      {isSuccess && <span className="text-green-500">✓</span>}
    </button>
  )
}
