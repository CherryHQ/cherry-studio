import { toolSearch } from 'ai'

import type { ToolEntry } from '../types'

export const TOOL_SEARCH_TOOL_NAME = 'tool_search'

export function createToolSearchTool(entries: readonly ToolEntry[]) {
  const namespaces = new Map(entries.map((entry) => [entry.name, entry.namespaceLabel ?? entry.namespace]))

  return toolSearch({
    search: ({ query, tools }) => {
      const needle = query.trim().toLocaleLowerCase()
      if (!needle) return []

      // Preserve substring and namespace discovery, including queries without word boundaries.
      return tools
        .filter(({ name, description }) =>
          [name, description, namespaces.get(name)].some((value) => value?.toLocaleLowerCase().includes(needle))
        )
        .sort(
          (a, b) =>
            Number(b.name.toLocaleLowerCase() === needle) - Number(a.name.toLocaleLowerCase() === needle) ||
            a.name.localeCompare(b.name)
        )
        .map(({ name }) => name)
    }
  })
}
