/**
 * Convert a string to camelCase, ensuring it's a valid JavaScript identifier.
 *
 * - Normalizes to lowercase first, then capitalizes word boundaries
 * - Non-alphanumeric characters are treated as word separators
 * - Non-ASCII characters are dropped (ASCII-only output)
 * - If result starts with a digit, prefixes with underscore
 *
 * @example
 * toCamelCase('my-server') // 'myServer'
 * toCamelCase('MY_SERVER') // 'myServer'
 * toCamelCase('123tool')   // '_123tool'
 */
export function toCamelCase(str: string): string {
  let result = str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+(.)/g, (_, char) => char.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '')

  if (result && !/^[a-zA-Z_]/.test(result)) {
    result = '_' + result
  }

  return result
}

export type McpToolNameOptions = {
  /** Prefix added before the name (e.g., 'mcp__'). Must be JS-identifier-safe. */
  prefix?: string
  /** Delimiter between server and tool parts (e.g., '_' or '__'). Must be JS-identifier-safe. */
  delimiter?: string
  /** Maximum length of the final name. Suffix numbers for uniqueness are included in this limit. */
  maxLength?: number
  /** Mutable Set for collision detection. The final name will be added to this Set. */
  existingNames?: Set<string>
}

/**
 * Build a valid JavaScript function name from server and tool names.
 * Uses camelCase for both parts.
 *
 * @param serverName - The MCP server name (optional)
 * @param toolName - The tool name
 * @param options - Configuration options
 * @returns A valid JS identifier
 */
export function buildMcpToolName(
  serverName: string | undefined,
  toolName: string,
  options: McpToolNameOptions = {}
): string {
  const { prefix = '', delimiter = '_', maxLength, existingNames } = options

  const serverPart = serverName ? toCamelCase(serverName) : ''
  const toolPart = toCamelCase(toolName)
  const baseName = serverPart ? `${prefix}${serverPart}${delimiter}${toolPart}` : `${prefix}${toolPart}`

  if (!existingNames) {
    return maxLength ? truncateToLength(baseName, maxLength) : baseName
  }

  let name = maxLength ? truncateToLength(baseName, maxLength) : baseName
  let counter = 1

  while (existingNames.has(name)) {
    const suffix = String(counter)
    const truncatedBase = maxLength ? truncateToLength(baseName, maxLength - suffix.length) : baseName
    name = `${truncatedBase}${suffix}`
    counter++
  }

  existingNames.add(name)
  return name
}

function truncateToLength(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str
  }
  return str.slice(0, maxLength).replace(/_+$/, '')
}

/**
 * Generate a unique function name from server name and tool name.
 * Format: serverName_toolName (camelCase)
 *
 * @example
 * generateMcpToolFunctionName('github', 'search_issues') // 'github_searchIssues'
 */
export function generateMcpToolFunctionName(
  serverName: string | undefined,
  toolName: string,
  existingNames?: Set<string>
): string {
  return buildMcpToolName(serverName, toolName, { existingNames })
}

const FUNCTION_CALL_TOOL_NAME_MAX_LENGTH = 63
/** `_` + a fixed-width base36 hash of the server name, reserved on truncation. */
const SERVER_DISAMBIGUATOR_LENGTH = 7

/**
 * FNV-1a 32-bit hash of the server name as a fixed-width base36 string.
 * Identifier-safe (`[0-9a-z]`) so it can sit inside a JS-identifier tool name.
 */
function hashServerName(serverName: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < serverName.length; i++) {
    h ^= serverName.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36).padStart(SERVER_DISAMBIGUATOR_LENGTH, '0').slice(-SERVER_DISAMBIGUATOR_LENGTH)
}

/**
 * Builds the legacy name-based MCP tool id used by persisted source-policy
 * rules and the Claude Code adapter. AI SDK catalog identities must use the
 * main-process `buildMcpToolWireId`, which includes stable server identity.
 *
 * Format: `mcp__{server}__{tool}` (camelCase), max 63 chars.
 *
 * When the untruncated name exceeds the cap the tail is dropped — and for long
 * server names the `__` delimiter and part of the server segment go with it. A
 * server-derived suffix (`_<hash(serverName)>`) keeps legacy ids deterministic
 * and disambiguates long server display names.
 *
 * @example
 * buildFunctionCallToolName('github', 'search_issues') // 'mcp__github__searchIssues'
 */
export function buildFunctionCallToolName(serverName: string, toolName: string): string {
  const serverPart = serverName ? toCamelCase(serverName) : ''
  const toolPart = toCamelCase(toolName)
  const baseName = serverPart ? `mcp__${serverPart}__${toolPart}` : `mcp__${toolPart}`
  if (baseName.length <= FUNCTION_CALL_TOOL_NAME_MAX_LENGTH) {
    return baseName
  }
  const suffix = `_${hashServerName(serverName)}`
  const body = truncateToLength(baseName, FUNCTION_CALL_TOOL_NAME_MAX_LENGTH - suffix.length)
  return `${body}${suffix}`
}

export type McpFunctionCallToolNameParts = {
  serverPart: string
  toolPart: string
}

/**
 * Saved agent-level denials written while MCP tools were keyed by server id (`mcp__<uuid>__tool`)
 * no longer match runtime names derived from the configured server name. Rewrite each legacy rule
 * whose server segment is a known id into the current server key; name-form rules (and rules naming
 * unknown servers) pass through unchanged. Ids contain no underscores, so splitting on the first
 * `__` is exact for legacy rules and never mis-splits a `__`-bearing server name.
 *
 * A configured name can extend another server's id (`U__x`): the saved string is then also that
 * server's current-form rule, so the rewrite emits both forms — stripping the literal form would
 * remove an explicit denial from the server that owns it under an exact-match policy.
 */
export function translateLegacyMcpToolRules(
  rules: readonly string[] | null | undefined,
  serverNameById: ReadonlyMap<string, string> = new Map()
): string[] {
  const mountedKeys = new Set(serverNameById.values())
  return (rules ?? []).flatMap((rule) => {
    if (!rule.startsWith('mcp__')) return [rule]
    const rest = rule.slice('mcp__'.length)
    const delimiterIndex = rest.indexOf('__')
    if (delimiterIndex <= 0) return [rule]
    const mapped = serverNameById.get(rest.slice(0, delimiterIndex))
    if (mapped === undefined) return [rule]
    const rewritten = `mcp__${mapped}${rest.slice(delimiterIndex)}`
    if (rewritten === rule) return [rule]
    const nameFormOwner = [...mountedKeys].some((key) => rest.startsWith(`${key}__`))
    return nameFormOwner ? [rule, rewritten] : [rewritten]
  })
}

/**
 * Rewrite denial rules onto the identities a tool bridge actually registered. An id-keyed rule
 * (`mcp__<uuid>__<raw tool>`) names one (server, raw tool) pair exactly, so it resolves through
 * the `<server key>\0<raw tool>` identity entry — a second pair whose name-form string flattens
 * identically (`docs` + `search__all` vs `docs__search` + `all`) cannot capture the denial.
 * After the legacy id rewrite, any rule whose name-form string matches a registered identity is
 * replaced by the allocated runtime name(s); a flattened string maps to every candidate
 * (fail-closed). Rules with no registered identity pass through unchanged.
 *
 * Every interpretation of the saved string contributes candidates: a configured name can extend
 * another server's id (`U__x`), making the string simultaneously the current name-form of one
 * pair and the legacy id form of another — the rewrite must never strip the original string's
 * registered candidates.
 */
export function translateMcpToolRulesToRuntimeNames(
  rules: readonly string[] | null | undefined,
  serverNameById: ReadonlyMap<string, string> = new Map(),
  runtimeNameByRule: ReadonlyMap<string, readonly string[]> = new Map()
): string[] {
  return (rules ?? []).flatMap((rule) => {
    const candidates = new Set<string>()
    const addAll = (names: readonly string[] | undefined) => {
      for (const name of names ?? []) candidates.add(name)
    }
    // The saved string as-is is itself a registered form (name-form rule, runtime identity,
    // historical collision/counter name, pre-name id alias). A configured name can extend
    // another server's id (`U__x`), making the string simultaneously the current name-form of
    // one pair and the legacy id form of another — the legacy rewrite below must never strip
    // these candidates, so every interpretation merges (fail-closed).
    addAll(runtimeNameByRule.get(rule))

    let candidate = rule
    if (candidate.startsWith('mcp__')) {
      const rest = candidate.slice('mcp__'.length)
      const delimiterIndex = rest.indexOf('__')
      if (delimiterIndex > 0) {
        const mapped = serverNameById.get(rest.slice(0, delimiterIndex))
        if (mapped !== undefined) {
          const pairNames = runtimeNameByRule.get(`${mapped}\u0000${rest.slice(delimiterIndex + 2)}`)
          if (pairNames) {
            // The saved string can simultaneously be another pair's historical collision/counter
            // name: a reconnect may bake the disambiguator into a real tool's name (so this pair
            // match names the NEW tool exactly) while the originally disabled identity moved to
            // the stripped plain name. Merge the stripped-base candidates instead of
            // short-circuiting; rules without a disambiguator tail keep their exact pair match.
            addAll(pairNames)
            const stripped = candidate.replace(/_[0-9a-f]{12}$/, '')
            if (stripped !== candidate) addAll(runtimeNameByRule.get(stripped))
            if (candidates.size > 0) return [...candidates]
          }
          candidate = `mcp__${mapped}${rest.slice(delimiterIndex)}`
        }
      }
    }
    const names = runtimeNameByRule.get(candidate)
    if (names) {
      // An exact hit can also be a historical counter-allocated denial name of another pair: a
      // reconnect may bake the disambiguator into a real tool's name, so the string now names
      // the new tool exactly while the originally disabled identity moved to the stripped base.
      // Merge the stripped-base candidates (fail-closed) instead of short-circuiting.
      const stripped = candidate.replace(/_[0-9a-f]{12}$/, '')
      const baseNames = stripped !== candidate ? runtimeNameByRule.get(stripped) : undefined
      if (!baseNames) return [...new Set([...names, ...candidates])]
      return [...new Set([...names, ...baseNames, ...candidates])]
    }
    // A denial can be saved under a collision-allocated name from an earlier topology
    // (`<plain name>_<disambiguator>` — the deterministic pair hash, or any counter depth when
    // even that was taken). The full string dies with the old allocation, but the stripped
    // plain name still resolves; mapping it beats letting an explicitly disabled tool execute.
    // The stripped hit must merge with the candidates already resolved from the original
    // string: a saved name whose own tail parses as a disambiguator (`y_123456789abc`) rewrites
    // onto another server first, and returning only the stripped base would strip the original
    // string's registered denial — letting that tool execute under an exact-match policy.
    const stripped = candidate.replace(/_[0-9a-f]{12}$/, '')
    if (stripped !== candidate) {
      const baseNames = runtimeNameByRule.get(stripped)
      if (baseNames) return [...new Set([...baseNames, ...candidates])]
    }
    return candidates.size > 0 ? [...candidates] : [candidate]
  })
}

/**
 * Parse MCP tool-call names in the Claude/AI-SDK format:
 * `mcp__{server}__{tool}`.
 *
 * Callers feed this raw provider payloads, where a tool name typed as `string`
 * can still be absent at runtime (see `ClaudeCodeStreamAdapter`), so a missing
 * name parses as "not an MCP name" rather than throwing.
 */
export function parseFunctionCallToolName(toolName: string | undefined): McpFunctionCallToolNameParts | null {
  if (!toolName?.startsWith('mcp__')) return null

  const rest = toolName.slice('mcp__'.length)
  const delimiterIndex = rest.lastIndexOf('__')
  if (delimiterIndex <= 0 || delimiterIndex >= rest.length - 2) return null

  return {
    serverPart: rest.slice(0, delimiterIndex),
    toolPart: rest.slice(delimiterIndex + 2)
  }
}

/**
 * Sanitize a mounted MCP server's configured name into its runtime record key. Runtime record
 * keys host SDK-derived tool ids (`mcp__<key>__<tool>`), so the key must never contain the `__`
 * delimiter (`docs__search` lets `docs` + `search__all` flatten onto the same identity) and must
 * never end in `_` (a trailing `_` blurs the delimiter into a tool name starting with `_`:
 * `docs` + `_run` and `docs_` + `run` both flatten to `mcp__docs___run`). Together both rules
 * make the first `__` after the prefix an unambiguous key boundary for every mounted pair.
 */
export function sanitizeAgentServerKey(name: string): string {
  return name.replace(/_{2,}/g, '_').replace(/_+$/, '')
}

/**
 * Rewrite saved DSH denial rules (`mcp__<key>__<tool>`) after their server was renamed: the
 * saved string encodes the key of the moment, and a rename reallocates the key (`docs` →
 * `github` orphans `mcp__docs__run`), letting the previously disabled tool execute under
 * `bypassPermissions`. Entries are matched on the sanitized old key and rewritten onto the
 * sanitized new key; anything else (other servers' entries, id-keyed rules, non-`mcp__` forms)
 * passes through untouched. Returns the migrated array, or undefined when nothing changed.
 *
 * Plain DSH runtime names (`<key>_<hash>`) are not migrated: their hash binds the tool pair,
 * which is unknowable without the server's live tool list at rename time.
 */
export function migrateDisabledToolsForServerRename(
  disabledTools: readonly string[],
  oldName: string,
  newName: string
): string[] | undefined {
  const fromKey = sanitizeAgentServerKey(oldName)
  const toKey = sanitizeAgentServerKey(newName)
  if (!fromKey || fromKey === toKey) return undefined

  let changed = false
  const migrated = disabledTools.map((entry) => {
    if (!entry.startsWith('mcp__')) return entry
    const rest = entry.slice('mcp__'.length)
    const delimiterIndex = rest.indexOf('__')
    if (delimiterIndex <= 0) return entry
    if (rest.slice(0, delimiterIndex) !== fromKey) return entry
    changed = true
    return `mcp__${toKey}__${rest.slice(delimiterIndex + 2)}`
  })
  return changed ? migrated : undefined
}

/** One mounted server a key allocation sees: the mounted reference (id) and its configured name. */
export interface MountedServerRef {
  mcpId: string
  name?: string
}

/**
 * Allocate each mounted server's runtime record key — the exact policy the agent runtime applies
 * when registering servers (built-ins and mounted ids reserved up front, configured name when
 * free, id fallback otherwise, allocation order breaking duplicate-name ties). Shared single
 * source so rename migration derives the same old and new identities the runtime will register,
 * instead of re-guessing them from the raw configured names.
 */
export function allocateMountedServerKeys(
  servers: ReadonlyArray<MountedServerRef>,
  reservedKeys: readonly string[]
): Map<string, string> {
  const taken = new Set<string>(reservedKeys)
  const keys = new Map<string, string>()
  for (const { mcpId, name } of servers) {
    const serverName = name && !taken.has(sanitizeAgentServerKey(name)) ? name : mcpId
    const key = sanitizeAgentServerKey(serverName) || sanitizeAgentServerKey(mcpId)
    taken.add(key)
    keys.set(mcpId, key)
  }
  return keys
}

export interface AgentServerRenameMigrationInput {
  /**
   * This agent's mounted servers with their configured (pre-rename) names, in mount order —
   * allocation order decides who owns a duplicated name.
   */
  mountedServers: ReadonlyArray<MountedServerRef>
  /** The server being renamed; must be one of `mountedServers` for the rules to be touched. */
  renamedServerId: string
  /** The name the server takes on. */
  toName: string
  /** Keys no user server may claim (built-in server names plus the sanitized mounted ids). */
  reservedKeys: readonly string[]
}

/**
 * Migrate one agent's saved denial rules after a mounted server was renamed. Unlike
 * {@link migrateDisabledToolsForServerRename} (server-level rules keyed by the configured name),
 * agent rules follow the runtime allocation: only the renamed server's own rules move, and onto
 * the key the allocator will actually hand out after the rename — the id when the new name is
 * reserved or taken by a sibling. An agent that does not mount the renamed server keeps its
 * rules untouched: duplicate names are accepted, so a bare name match would steal a denial
 * owned by a different server and let the originally disabled tool execute.
 *
 * Lossy-hashed entries (`mcp__<camelized old name>__<tool>_<hash>`) cannot be rewritten onto
 * the pair — the hash binds the old name. They are copied onto the new lossy base with the
 * hash tail intact: the runtime's stripped-base lookup indexes
 * `buildDshCherryToolName(<new key>, tool).slice(0, 50)` for every live tool, which is exactly
 * what the tail-stripped copy lands on. Copying (not replacing) keeps the original string's
 * registered candidates: it can simultaneously be another mounted server's exact denial.
 * Entries whose saved form was truncated before the tool part can be isolated (truncation cut
 * into the server segment, or the retained prefix is shorter than the renamed base) are
 * unrecoverable and pass through unchanged.
 */
export function migrateAgentDisabledToolsForServerRename(
  disabledTools: readonly string[],
  input: AgentServerRenameMigrationInput
): string[] | undefined {
  const fromKey = allocateMountedServerKeys(input.mountedServers, input.reservedKeys).get(input.renamedServerId)
  // Not mounted here: nothing of this server's is owned by the agent.
  if (fromKey === undefined) return undefined
  const toKey = allocateMountedServerKeys(
    input.mountedServers.map((server) =>
      server.mcpId === input.renamedServerId ? { ...server, name: input.toName } : server
    ),
    input.reservedKeys
  ).get(input.renamedServerId)
  if (toKey === undefined || toKey === fromKey) return undefined

  const fromLossy = toCamelCase(fromKey)
  // The lossy form only carries separate information when normalization changed the name
  // (`Old server` → `oldServer`); otherwise every entry already sits on the plain key.
  const lossyApplies = fromLossy !== fromKey
  const toLossy = toCamelCase(toKey)

  let changed = false
  const seen = new Set(disabledTools)
  const migrated: string[] = []
  for (const entry of disabledTools) {
    let replacement: string | undefined
    let keepOriginal = false
    if (entry.startsWith('mcp__')) {
      const rest = entry.slice('mcp__'.length)
      const delimiterIndex = rest.indexOf('__')
      if (delimiterIndex > 0) {
        const serverPart = rest.slice(0, delimiterIndex)
        const toolPart = rest.slice(delimiterIndex + 2)
        if (serverPart === fromKey) {
          replacement = `mcp__${toKey}__${toolPart}`
        } else if (lossyApplies && serverPart === fromLossy && /_[0-9a-f]{12}$/.test(toolPart)) {
          const tailIndex = toolPart.length - 13
          replacement = `mcp__${toLossy}__${toolPart.slice(0, tailIndex)}`.slice(0, 50) + toolPart.slice(tailIndex)
          keepOriginal = true
        }
      }
    }
    if (replacement !== undefined && replacement !== entry && !seen.has(replacement)) {
      seen.add(replacement)
      changed = true
      if (keepOriginal) migrated.push(entry)
      migrated.push(replacement)
      continue
    }
    migrated.push(entry)
  }
  return changed ? migrated : undefined
}
