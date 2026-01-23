export type ToolNameMapping = {
  /** original tool id (serverId__toolName) -> js name */
  toJs: Map<string, string>
  /** js name -> original tool id (serverId__toolName) */
  toOriginal: Map<string, string>
}

/**
 * Convert a namespaced tool id (serverId__tool_name) into a JS-friendly camelCase name.
 *
 * Examples:
 * - github__search_repos -> githubSearchRepos
 * - my-tool-name -> myToolName
 */
export function toJsName(name: string): string {
  if (!name) return name

  let result = ''
  let capitalizeNext = false
  let isFirstChar = true

  for (const ch of name) {
    if (ch === '_' || ch === '-') {
      capitalizeNext = true
      continue
    }

    if (isFirstChar) {
      result += ch.toLowerCase()
      isFirstChar = false
      capitalizeNext = false
      continue
    }

    if (capitalizeNext && /[A-Za-z]/.test(ch)) {
      result += ch.toUpperCase()
      capitalizeNext = false
      continue
    }

    result += ch
  }

  return result
}

export function parseNamespacedName(name: string): { serverId: string; toolName: string; isNamespaced: boolean } {
  const parts = name.split('__')
  if (parts.length >= 2) {
    const [serverId, ...rest] = parts
    return { serverId, toolName: rest.join('__'), isNamespaced: true }
  }
  return { serverId: '', toolName: name, isNamespaced: false }
}

export function isNamespacedName(name: string): boolean {
  return name.includes('__')
}

/**
 * Build a bidirectional tool name mapping.
 *
 * If a collision happens after JS-name conversion, we deterministically suffix names:
 *   githubSearchRepos, githubSearchRepos_2, githubSearchRepos_3...
 */
export function buildToolNameMapping(originalToolIds: string[]): ToolNameMapping {
  const toJs = new Map<string, string>()
  const toOriginal = new Map<string, string>()

  for (const original of originalToolIds) {
    const base = toJsName(original)
    let jsName = base
    let i = 2
    while (toOriginal.has(jsName)) {
      jsName = `${base}_${i}`
      i += 1
    }

    toJs.set(original, jsName)
    toOriginal.set(jsName, original)
  }

  return { toJs, toOriginal }
}

export function resolveToolId(mapping: ToolNameMapping, nameOrId: string): string | undefined {
  if (!nameOrId) return undefined

  if (isNamespacedName(nameOrId)) {
    return nameOrId
  }

  return mapping.toOriginal.get(nameOrId)
}
