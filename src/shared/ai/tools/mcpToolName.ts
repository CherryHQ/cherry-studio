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

/**
 * Whether a saved denial's tool fragment is the bounded form {@link buildFunctionCallToolName}
 * produces for `raw` under the saved server segment: past the 63-char cap the untruncated
 * `mcp__<segment>__<camelized raw>` name loses its tail and gains `_<hash(serverName)>`, so the
 * fragment is the TRUNCATED camelization plus an 8-character suffix and the plain
 * complete-camelization comparison can never match it. The hash is computed over the ORIGINAL
 * configured name, which cannot be recovered from the saved string, so the suffix is matched
 * structurally (`_` + the fixed-width hash) while the body must equal the replayed truncation
 * exactly — a different raw tool can only collide by sharing the entire truncated prefix, and
 * emitting both spellings is the same fail-closed direction as any other ambiguous resolution.
 */
function isBoundedAliasToolFragment(serverPart: string, toolPart: string, raw: string): boolean {
  const prefix = `mcp__${serverPart}__`
  const baseName = `${prefix}${toCamelCase(raw)}`
  if (baseName.length <= FUNCTION_CALL_TOOL_NAME_MAX_LENGTH) return false
  const body = truncateToLength(baseName, FUNCTION_CALL_TOOL_NAME_MAX_LENGTH - SERVER_DISAMBIGUATOR_LENGTH - 1).slice(
    prefix.length
  )
  return (
    toolPart.length === body.length + SERVER_DISAMBIGUATOR_LENGTH + 1 &&
    toolPart.startsWith(body) &&
    toolPart.charAt(body.length) === '_'
  )
}

export type McpFunctionCallToolNameParts = {
  serverPart: string
  toolPart: string
}

/**
 * The Claude Agent SDK derives MCP tool names from the server record key by replacing only the
 * characters invalid in a Claude tool name with underscores — hyphens are valid and survive
 * verbatim (`Docs MCP` → `Docs_MCP`, `my-tools` → `my-tools`). Policy identities that name
 * SDK-served tools must use this segment form — an entry spelling the raw key names a tool the
 * SDK never invokes, so an exact-match denial lapses.
 */
export function toSdkMcpServerSegment(key: string): string {
  return key.replace(/[^A-Za-z0-9_-]/g, '_')
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
 * remove an explicit denial from the server that owns it under an exact-match policy. The
 * rewritten form carries the SDK-normalized key segment (see {@link toSdkMcpServerSegment}).
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
    const rewritten = `mcp__${toSdkMcpServerSegment(mapped)}${rest.slice(delimiterIndex)}`
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
      // The stripped base can exactly hit a SHORTER sibling's registered name: a long tool
      // truncates onto the retention base that a short tool of the same server fills verbatim,
      // so an exact hit proves nothing about the saved denial's original identity. Merge the
      // exact hit with every registered identity extending the fragment instead of returning
      // early — the early return skips the scan below and re-enables the longer tool.
      const baseNames = runtimeNameByRule.get(stripped)
      // A copy rebuilt from a truncated fragment cannot always land on the new allocation's
      // base: a shortening rename leaves the stripped fragment a strict prefix of the base the
      // runtime indexes for the pair. Every registered identity extending the fragment
      // resolves — over-blocking beats letting an explicitly disabled tool execute (the same
      // policy as flattened name-form keys). Only disambiguator-tailed strings scan: a plain
      // name-form miss names an unmounted server, and prefix-matching it would blanket-deny
      // longer unrelated tools sharing the prefix.
      const extended: string[] = []
      for (const [registered, names] of runtimeNameByRule) {
        if (registered.length > stripped.length && registered.startsWith(stripped)) extended.push(...names)
      }
      if (baseNames || extended.length > 0) {
        return [...new Set([...(baseNames ?? []), ...extended, ...candidates])]
      }
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
 * The configured name folded into the SDK's callable namespace FIRST, then stripped of `__`
 * runs and trailing `_`. Applying the delimiter protection to the final normalized form is
 * what makes it airtight: `docs  search` normalizes to the segment `docs__search`, whose `__`
 * would fuse onto the `docs` + `search__all` callable — a protection applied before
 * normalization never sees that `__`. Allocation and every rename migration derive their keys
 * through this, so the persisted rules, the record keys and the SDK namespaces stay one form.
 */
export function sdkSafeServerKey(name: string): string {
  return sanitizeAgentServerKey(toSdkMcpServerSegment(name))
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
  const fromKey = sdkSafeServerKey(oldName)
  const toKey = sdkSafeServerKey(newName)
  if (!fromKey || fromKey === toKey) return undefined

  let changed = false
  const migrated: string[] = []
  const emitted = new Set<string>()
  const push = (value: string) => {
    if (emitted.has(value)) return
    emitted.add(value)
    migrated.push(value)
  }
  for (const entry of disabledTools) {
    if (!entry.startsWith('mcp__')) {
      push(entry)
      continue
    }
    const rest = entry.slice('mcp__'.length)
    const delimiterIndex = rest.indexOf('__')
    if (delimiterIndex <= 0 || rest.slice(0, delimiterIndex) !== fromKey) {
      push(entry)
      continue
    }
    // Server-level rules feed matchesMcpSourceToolRule, where an entry matches the literal
    // provider tool name, the tool id, or the wire form of the CURRENT configured name. A
    // `mcp__<old-key>__<tool>` entry can therefore be either a literal tool name that happens
    // to look like a qualified identity (rename-independent) or the old wire form
    // (rename-dependent) — indistinguishable at migration time, so keep the original alongside
    // the migrated alias. These rules only ever gate this server's own tools, so the kept
    // literal cannot over-block another server.
    changed = true
    push(entry)
    push(`mcp__${toKey}__${rest.slice(delimiterIndex + 2)}`)
  }
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
 *
 * Collisions are checked in the SDK's callable namespace: two distinct keys whose
 * {@link toSdkMcpServerSegment} forms coincide (`Docs MCP` vs `Docs_MCP`) would both register
 * `mcp__Docs_MCP__*` tools, so the later claim falls back to its id and every mounted server
 * keeps its own callable surface.
 */
export function allocateMountedServerKeys(
  servers: ReadonlyArray<MountedServerRef>,
  reservedKeys: readonly string[]
): Map<string, string> {
  const taken = new Set<string>(reservedKeys)
  const takenSdkSegments = new Set<string>(reservedKeys.map(toSdkMcpServerSegment))
  const keys = new Map<string, string>()
  for (const { mcpId, name } of servers) {
    const candidate = name ? sdkSafeServerKey(name) : ''
    const nameFree =
      candidate.length > 0 && !taken.has(candidate) && !takenSdkSegments.has(toSdkMcpServerSegment(candidate))
    const serverName = name && nameFree ? name : mcpId
    const key = sdkSafeServerKey(serverName) || sdkSafeServerKey(mcpId)
    taken.add(key)
    takenSdkSegments.add(toSdkMcpServerSegment(key))
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
  /**
   * Mounted ids that held no allocation key BEFORE the change — the runtime reserves every
   * mounted id and then skips the in-memory browser, so a browser-named server owns nothing
   * yet still displaces nobody. Counting it as a pre-change candidate would hand it a phantom
   * key that steals the rewrite of the sibling actually named after that segment.
   */
  nonCandidateIdsBefore?: ReadonlySet<string>
  /**
   * The same exclusions applied to the post-change allocation. Eligibility is derived
   * separately per set because the rename itself can flip it: a browser renamed onto a normal
   * name ENTERS the allocation (displacing the sibling holding that name onto its id), and a
   * server renamed onto the browser's name LEAVES it like a departure.
   */
  nonCandidateIdsAfter?: ReadonlySet<string>
  /**
   * Raw tool names per mounted server id, from the server's tool catalog at migration time.
   * Without a server's entry (or with an empty one) its camelized fragments cannot be
   * reverse-mapped, and the migration keeps their camelized spellings — fail-closed — rather
   * than guessing a raw tool name.
   */
  toolNamesByServerId?: ReadonlyMap<string, readonly string[]>
}

interface AgentKeyRewrite {
  fromKey: string
  toKey: string
  /**
   * Camelized form of the renamed server's new configured name, set only when that name won
   * its allocation and camelizes differently: Pi resolves denials through the camelized
   * configured name (`GitHub` → `mcp__github__run`), so the rewrite must carry that alias or
   * the runtime-independent migration would strip Pi's only surviving form.
   */
  camelToKey?: string
  /**
   * The old key was this server's id: Pi registers servers under their id and matches
   * `mcp__<id>__tool` verbatim at any tool length, so that form stays resolvable across every
   * reallocation and must survive the migration (the replacements cannot regenerate a bounded
   * long-tool identity — the full tool name is unrecoverable past the runtime's truncation).
   * An id can never be reassigned to a different server, so keeping the original cannot
   * over-block.
   */
  fromIsId?: boolean
  /**
   * The old key's segment no longer names this server after the change: another mounted
   * server's post-change key takes the segment over (a rename claim, a displacement, a
   * reorder), or the owner is departing and the configured-name key is released to the next
   * claimant. The saved strings spelled under the segment become the new owner's registered
   * identity the moment the change lands. The original survives the takeover regardless (the
   * fail-closed over-block of the claimant beats permitting the explicitly disabled tool — see
   * the original-preservation reasoning in {@link applyAgentKeyRewrites}); this flag drives the
   * bounded fold-class synthesis that restores the stable-id forms Pi matches verbatim.
   */
  aliasOwnershipLost?: boolean
  /**
   * This server's raw tool names from its tool catalog at migration time. Pi saves denials
   * through `buildFunctionCallToolName`, which camelizes the raw tool (`get_time` → `getTime`),
   * while the identities a rewrite can land on keep the raw spelling (Pi's stable-id
   * `mcp__<id>__<raw tool>` match, the SDK's served `mcp__<key>__<raw tool>`) — the raw
   * fragment is only recoverable by reverse-mapping the camelized fragment against this list.
   */
  toolNames?: readonly string[]
}

/**
 * Migrate one agent's saved denial rules after a mounted server was renamed. Unlike
 * {@link migrateDisabledToolsForServerRename} (server-level rules keyed by the configured name),
 * agent rules follow the runtime allocation: every mounted server whose allocated key changes —
 * the renamed server and any sibling displaced onto its id by the renamed server's new claim —
 * has its rules moved onto the key the allocator will actually hand out after the rename. Each
 * old key is unique across the mounted set, so an entry's server segment names at most one of
 * them. An agent that does not mount the renamed server keeps its rules untouched: duplicate
 * names are accepted, so a bare name match would steal a denial owned by a different server and
 * let the originally disabled tool execute.
 *
 * Entries carrying a trailing `_12hex` hash were saved as lossy or collision runtime names whose
 * hash binds the old pair. Carrying that fragment past a longer prefix matches neither the new
 * runtime name nor its 50-char stripped base, so the copy is rewritten onto the stripped base
 * exactly (`mcp__<camelized new key>__<fragment>` truncated to 50, tail re-attached): the
 * runtime's stripped-base lookup resolves it once the tail is stripped again. The original is
 * kept — it can simultaneously be another mounted server's exact denial. Plain entries move
 * verbatim onto the new key. The same suffix can also be a plain literal tool name, so each
 * hashed rewrite additionally carries the complete literal destination (raw, camelized-tool and
 * SDK-segment forms) — the truncated copies alone would clip a long literal past the 50-char
 * base while the runtime serves the full name.
 */
export function migrateAgentDisabledToolsForServerRename(
  disabledTools: readonly string[],
  input: AgentServerRenameMigrationInput
): string[] | undefined {
  // An agent that does not mount the renamed server keeps its rules untouched: duplicate
  // names are accepted, so a blanket name match would steal a rule owned by a different server
  // — including one still exposing the tool the rule was written for. Mounting alone is the
  // gate, not holding an old key: a pre-change browser owns nothing, yet its new claim can
  // still displace a sibling whose denial must follow.
  if (!input.mountedServers.some(({ mcpId }) => mcpId === input.renamedServerId)) return undefined
  const candidates = (skip?: ReadonlySet<string>): ReadonlyArray<MountedServerRef> =>
    skip ? input.mountedServers.filter(({ mcpId }) => !skip.has(mcpId)) : input.mountedServers
  const oldKeys = allocateMountedServerKeys(candidates(input.nonCandidateIdsBefore), input.reservedKeys)
  const newKeys = allocateMountedServerKeys(
    candidates(input.nonCandidateIdsAfter).map((server) =>
      server.mcpId === input.renamedServerId ? { ...server, name: input.toName } : server
    ),
    input.reservedKeys
  )

  // The rename can displace more than the renamed server: a sibling whose claimed key is taken
  // by the renamed server's new name falls back to its id, orphaning its own denials. Compare
  // the complete allocations and migrate every mounted server whose record key changed.
  const rewrites: AgentKeyRewrite[] = []
  for (const [mcpId, oldKey] of oldKeys) {
    const newKey = newKeys.get(mcpId)
    if (newKey === undefined) {
      // The rename can also remove a server from the allocation entirely (a rename onto the
      // in-memory browser's name): its configured-name key is released to the next claimant,
      // and the same departing semantics a mount removal applies hold here — move the denial
      // onto the stable id BEFORE the release, so it travels with its owner instead of
      // denying the claimant in its place.
      const stableKey = sanitizeAgentServerKey(mcpId)
      if (oldKey !== stableKey) {
        rewrites.push({
          fromKey: oldKey,
          toKey: stableKey,
          fromIsId: false,
          aliasOwnershipLost: keyClaimedByOtherServer(newKeys, mcpId, oldKey),
          toolNames: input.toolNamesByServerId?.get(mcpId)
        })
      }
      continue
    }
    if (newKey === oldKey) continue
    // Pi's camelized alias derives from the configured name, so the extra form is only
    // meaningful for the renamed server itself, when its new name actually won its allocation
    // (and camelizes differently). Displaced siblings fall back to their id, which Pi already
    // matches through its raw-identity check.
    const camelToKey =
      mcpId === input.renamedServerId &&
      newKey === sdkSafeServerKey(input.toName) &&
      toCamelCase(input.toName) !== newKey
        ? toCamelCase(input.toName)
        : undefined
    rewrites.push({
      fromKey: oldKey,
      toKey: newKey,
      camelToKey,
      fromIsId: oldKey === sanitizeAgentServerKey(mcpId),
      aliasOwnershipLost: keyClaimedByOtherServer(newKeys, mcpId, oldKey),
      toolNames: input.toolNamesByServerId?.get(mcpId)
    })
  }
  return applyAgentKeyRewrites(disabledTools, rewrites, collectMountedIdSegments(input.mountedServers))
}

export interface AgentAllocationChangeInput {
  /**
   * This agent's mounted servers with their configured (pre-change) names, in allocation order.
   */
  oldMountedServers: ReadonlyArray<MountedServerRef>
  /** The same agent's mounted servers after the change, in allocation order. */
  newMountedServers: ReadonlyArray<MountedServerRef>
  /** Keys no user server may claim (built-in server names; mounted ids are reserved per set). */
  reservedKeys: readonly string[]
  /**
   * Mounted ids reserved per set WITHOUT becoming allocation candidates: the runtime reserves
   * every mounted id before skipping servers it never registers (the in-memory browser), so a
   * configured name equal to such an id holds the id before the change and falls back to its
   * own id after — exactly as {@link resolveMountedAgentMcpServers} allocates it. Each id is
   * reserved only in the sets it is mounted in, and it never claims a configured name.
   */
  nonCandidateIds?: ReadonlySet<string>
  /**
   * Raw tool names per mounted server id, from the server's tool catalog at migration time.
   * Without a server's entry (or with an empty one) its camelized fragments cannot be
   * reverse-mapped, and the migration keeps their camelized spellings — fail-closed — rather
   * than guessing a raw tool name.
   */
  toolNamesByServerId?: ReadonlyMap<string, readonly string[]>
}

/**
 * Migrate one agent's saved denial rules after its mount set changed. A mount change reallocates
 * record keys the same way a rename does: a newly mounted server reserves its sanitized id up
 * front, so a sibling whose configured name equals that id is displaced onto its own id — and a
 * saved rule keyed by the displaced key would then resolve through the newcomer's pre-name
 * alias, blocking the wrong server's tool while the explicitly disabled one executes. Compare
 * the complete before/after allocations and rewrite every mounted server whose record key
 * changed; a stable allocation returns undefined. A mixed-case destination configured name
 * carries the camelized alias Pi resolves denials through, and an id-keyed original survives
 * the migration (Pi's verbatim `mcp__<id>__tool` match is allocation-independent).
 */
export function migrateAgentDisabledToolsForAllocationChange(
  disabledTools: readonly string[],
  input: AgentAllocationChangeInput
): string[] | undefined {
  const skipCandidates = input.nonCandidateIds
  const allocation = (servers: ReadonlyArray<MountedServerRef>) =>
    allocateMountedServerKeys(skipCandidates ? servers.filter(({ mcpId }) => !skipCandidates.has(mcpId)) : servers, [
      ...input.reservedKeys,
      ...servers.map(({ mcpId }) => sanitizeAgentServerKey(mcpId))
    ])
  const oldKeys = allocation(input.oldMountedServers)
  const newKeys = allocation(input.newMountedServers)
  const rewrites: AgentKeyRewrite[] = []
  for (const [mcpId, oldKey] of oldKeys) {
    const newKey = newKeys.get(mcpId)
    if (newKey === undefined) {
      // Departing server: its configured-name key is released to the allocation, and the next
      // claimant registers exactly the strings saved under that key — moving the denial onto
      // the departing server's stable id BEFORE the release keeps the denial with its owner
      // instead of denying the claimant in its place. An id key is never reassigned, so a
      // denial already keyed by the id needs no move (an id-keyed original also survives the
      // rewrite below). The takeover flag is decided against the CURRENT mount set: a key no
      // present server holds is released unclaimed, and the saved display-name strings stay
      // enforceable for a remount under the same name (they name nobody else's registered
      // identity), while a key a sibling already claims makes those strings that sibling's
      // registered identity the moment the departure lands.
      const stableKey = sanitizeAgentServerKey(mcpId)
      if (oldKey !== stableKey) {
        rewrites.push({
          fromKey: oldKey,
          toKey: stableKey,
          fromIsId: false,
          aliasOwnershipLost: keyClaimedByOtherServer(newKeys, mcpId, oldKey),
          toolNames: input.toolNamesByServerId?.get(mcpId)
        })
      }
      continue
    }
    if (newKey === oldKey) continue
    // Pi's camelized alias derives from the configured name, so the extra form is only
    // meaningful when the post-change configured name actually won its allocation (and
    // camelizes differently) — the same condition the rename migration applies.
    const next = input.newMountedServers.find((server) => server.mcpId === mcpId)
    const camelToKey =
      next?.name && newKey === sdkSafeServerKey(next.name) && toCamelCase(next.name) !== newKey
        ? toCamelCase(next.name)
        : undefined
    rewrites.push({
      fromKey: oldKey,
      toKey: newKey,
      camelToKey,
      fromIsId: oldKey === sanitizeAgentServerKey(mcpId),
      aliasOwnershipLost: keyClaimedByOtherServer(newKeys, mcpId, oldKey),
      toolNames: input.toolNamesByServerId?.get(mcpId)
    })
  }
  if (rewrites.length === 0) return undefined
  return applyAgentKeyRewrites(disabledTools, rewrites, collectMountedIdSegments(input.oldMountedServers))
}

/**
 * Every segment form a mounted server's id registers under: the raw sanitized id (agent-level
 * key forms and Claude's legacy-rule translation) and Pi's native form (Pi names servers by
 * their id, underscoring every character invalid in its tool names — hyphens included — and
 * matching the registered name verbatim). An entry carrying one of these segments is that
 * server's native registered identity, so a rewrite must never strip it even when the segment
 * also spells another server's old configured-name key.
 *
 * Computed from the PRE-change mount set only: a server entering in the new set has no denial
 * written before it existed, so a segment spelling its id is purely the displaced owner's old
 * configured-name rule and its copies must move off it (blocking the newcomer's tool in its
 * place would be exactly the mis-attribution the allocation migration exists to fix). The
 * unresolvable original survives the move regardless (fail-closed — every original does; see
 * the original-preservation reasoning in {@link applyAgentKeyRewrites}); it can then over-block
 * only a newcomer tool whose raw spelling the fragment literally names.
 */
function collectMountedIdSegments(servers: ReadonlyArray<MountedServerRef>): Set<string> {
  const segments = new Set<string>()
  for (const { mcpId } of servers) {
    segments.add(sanitizeAgentServerKey(mcpId))
    segments.add(mcpId.replace(/[^A-Za-z0-9_]/g, '_'))
  }
  return segments
}

/**
 * Whether another mounted server's post-change key takes over the old key's SDK segment. The
 * allocator keeps claimed keys segment-unique, so segment equality pins the takeover: every
 * string spelled under the old key becomes the new owner's registered identity, and a
 * display-name alias kept for the old owner would deny the new owner's tool in its place.
 */
function keyClaimedByOtherServer(newKeys: ReadonlyMap<string, string>, ownerId: string, oldKey: string): boolean {
  const segment = toSdkMcpServerSegment(oldKey)
  for (const [mcpId, key] of newKeys) {
    if (mcpId === ownerId) continue
    if (toSdkMcpServerSegment(key) === segment) return true
  }
  return false
}

/**
 * Rewrite saved entries onto the keys a new allocation hands out. Every entry's replacements
 * are planned against the original list BEFORE anything is emitted, and the final output is
 * deduped afterwards: deduping during the walk lets one rule's not-yet-processed original
 * suppress another entry's required replacement while that original itself moves away,
 * silently re-enabling the displaced tool.
 *
 * Hashed tails mark lossy or collision runtime names whose hash binds the old pair, so only
 * the stripped base survives: each copy lands on `mcp__<target>__<fragment>` truncated to 50
 * with the tail re-attached, on every base form the runtime indexes — the raw key when it can
 * head a registered name (plain wire-safe registrations index their name-form verbatim,
 * including collision names carrying a raw tool fragment) and the camelized key (lossy
 * registrations are built from the camelized form, and mixed-case destinations register plain
 * names the camelized fragment can never key). The original is kept — it can simultaneously
 * be another server's exact denial. A literal tool name can spell the same `_12hex` suffix, so
 * the hashed copies are emitted alongside the complete literal destination (the same raw,
 * camelized-tool and SDK-segment forms the plain branch emits): the truncated copy alone names
 * a string no runtime registered when the tail was never a hash. Plain entries move verbatim
 * onto the new key (plus the camelized alias a `camelToKey` rewrite carries), except an
 * id-keyed original stays: Pi registers servers under their id and matches `mcp__<id>__tool`
 * verbatim at any tool length, so that form is the one denial Pi still matches after every
 * reallocation — including when the entry's segment doubles as another server's old
 * configured-name key.
 *
 * A truncated DSH identity (`mcp__<50 fused chars>_<12hex>` — a long server key pushes the
 * `__` delimiter and the tool fragment past the retention cap, so no delimiter survives) is
 * recognized as the old key's truncation and rewritten onto the new key's fragment; the
 * enforcement lookup's stripped-prefix scan resolves it onto the new identity from there.
 */
function applyAgentKeyRewrites(
  disabledTools: readonly string[],
  rewrites: ReadonlyArray<AgentKeyRewrite>,
  idSegments: ReadonlySet<string> = new Set()
): string[] | undefined {
  const rewriteHashed = (toolPart: string, targetKey: string): string[] => {
    const targets = new Set<string>([toCamelCase(targetKey)])
    if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(targetKey)) targets.add(targetKey)
    const tail = toolPart.slice(toolPart.length - 13)
    const fragment = toolPart.slice(0, toolPart.length - 13)
    return [...targets].map((target) => `mcp__${target}__${fragment}`.slice(0, 50) + tail)
  }

  // Every destination also resolves the fragment against the owning server's raw tool list: a
  // Pi-saved denial camelizes the raw tool (`get_time` → `getTime`), while the identities the
  // copies land on keep the raw spelling — Pi matches `mcp__<id>__<raw tool>` verbatim and the
  // SDK serves `mcp__<key>__<raw tool>` — so a camelized fragment alone names no registered
  // tool. Each raw tool whose camelization equals the saved fragment contributes its raw,
  // camelized-tool and SDK-segment forms; a fragment matching several raw spellings contributes
  // all of them (fail-closed). A saved fragment past the bounded cap (`buildFunctionCallToolName`
  // truncates long names and appends the server hash) is resolved by replaying that build against
  // every raw tool (see {@link isBoundedAliasToolFragment}). No catalog entry means no
  // resolution — `rawResolved` stays false — and even a resolution only ever covers the
  // spellings the snapshot holds, so the caller always keeps the original string (fail-closed)
  // rather than trusting a partial recovery.
  const targetForms = (
    rewrite: AgentKeyRewrite,
    toolPart: string,
    serverPart: string
  ): { targets: string[]; rawResolved: boolean } => {
    const targets = new Set<string>([`mcp__${rewrite.toKey}__${toolPart}`])
    targets.add(`mcp__${rewrite.camelToKey ?? rewrite.toKey}__${toCamelCase(toolPart)}`)
    targets.add(`mcp__${toSdkMcpServerSegment(rewrite.toKey)}__${toolPart}`)
    let rawResolved = false
    for (const raw of rewrite.toolNames ?? []) {
      if (toCamelCase(raw) !== toolPart && !isBoundedAliasToolFragment(serverPart, toolPart, raw)) continue
      rawResolved = true
      targets.add(`mcp__${rewrite.toKey}__${raw}`)
      targets.add(`mcp__${rewrite.camelToKey ?? rewrite.toKey}__${toCamelCase(raw)}`)
      targets.add(`mcp__${toSdkMcpServerSegment(rewrite.toKey)}__${raw}`)
    }
    return { targets: [...targets], rawResolved }
  }

  // A camelization-identity fragment folds every case spelling onto itself (`RUN`, `Run` and
  // `run` all camelize to `run`), so snapshot-backed copies can name none of the raw spellings
  // the alias historically represented. When a resolution SUCCEEDED against a partial snapshot
  // and the segment's ownership moved to a claimant, synthesize the bounded fold-class
  // spellings (ALL-UPPER, Title) on the owner-bound destinations: an id is never reassigned, so
  // the variants can only over-block the owner's own same-spelling tools — the fail-closed
  // direction — and they restore the form Pi matches verbatim (`mcp__<id>__RUN`) after the
  // remount. Fragments whose camelization is not the identity fold no case variants (a raw
  // `GetTime` registers `gettime`, not `getTime`), so the snapshot enumeration remains the only
  // source there.
  const foldClassTargets = (
    rewrite: AgentKeyRewrite,
    toolPart: string,
    serverPart: string,
    rawResolved: boolean
  ): string[] => {
    if (
      rewrite.aliasOwnershipLost !== true ||
      rewrite.fromIsId === true ||
      idSegments.has(serverPart) ||
      !rawResolved ||
      toCamelCase(toolPart) !== toolPart
    )
      return []
    const ownerKeys = [rewrite.toKey, toSdkMcpServerSegment(rewrite.toKey)]
    if (rewrite.camelToKey) ownerKeys.push(rewrite.camelToKey)
    return ownerKeys.flatMap((ownerKey) => [
      `mcp__${ownerKey}__${toolPart.toUpperCase()}`,
      `mcp__${ownerKey}__${toolPart.charAt(0).toUpperCase() + toolPart.slice(1)}`
    ])
  }

  const planned = disabledTools.map((entry) => {
    let replacements: string[] | undefined
    if (entry.startsWith('mcp__')) {
      const rest = entry.slice('mcp__'.length)
      const delimiterIndex = rest.indexOf('__')
      if (delimiterIndex > 0) {
        const serverPart = rest.slice(0, delimiterIndex)
        const toolPart = rest.slice(delimiterIndex + 2)
        // A previous migration may have persisted the SDK-normalized key form (`Docs_MCP` for
        // the key `Docs MCP`), so a rewrite must recognize that form as its owner's — otherwise
        // the saved denial passes through unmigrated after the next rename.
        const matched = rewrites.find(
          ({ fromKey: key }) => serverPart === key || serverPart === toSdkMcpServerSegment(key)
        )
        const lossyMatched = matched
          ? undefined
          : rewrites.find(({ fromKey: key }) => serverPart === toCamelCase(key) && toCamelCase(key) !== key)
        if (matched && /_[0-9a-f]{12}$/.test(toolPart)) {
          // A `_12hex` tail is also the shape a plain literal tool name can spell (`a`*38 +
          // `_123456789abc`), indistinguishable from a legacy hashed identity by its suffix
          // alone. The literal interpretation moves the COMPLETE tool segment onto the new
          // key's namespace (the `targetForms` destinations). Emitting only the truncated
          // hashed copies would clip a long literal past the 50-char base (37 of 38 `a`s)
          // while the runtime serves the full name, so neither persisted rule matches and the
          // explicitly disabled tool executes.
          replacements = [
            ...rewriteHashed(toolPart, matched.toKey),
            ...targetForms(matched, toolPart, serverPart).targets
          ]
        } else if (matched) {
          // Pi resolves denials through `buildFunctionCallToolName`, which camelizes BOTH
          // segments (`GitHub` + `get_time` registers `mcp__github__getTime`): copying the raw
          // tool segment onto the camelized key emits a string no runtime registered, and the
          // explicitly disabled tool executes. The camelized-tool variant is emitted
          // unconditionally — a plain destination key folds onto itself in the set — because
          // the key needing no camelization says nothing about the tool segment. The
          // SDK-normalized key segment is emitted alongside the raw form: the SDK invokes
          // `mcp__Docs_MCP__run` for the key `Docs MCP`, so without it neither surviving copy
          // names a tool the SDK serves. A camelized saved fragment additionally resolves
          // against the server's raw tool list (see `targetForms`): the stable-id and SDK
          // destinations keep the raw spelling the camelized copy cannot name.
          const { targets, rawResolved } = targetForms(matched, toolPart, serverPart)
          // An id-keyed original is a native registered identity (Pi registers servers under
          // their id and matches `mcp__<id>__tool` verbatim at any tool length), so it must
          // survive the migration: the copies cannot regenerate a bounded long-tool identity,
          // and dropping the original removes the only form Pi still matches. This includes an
          // entry whose segment merely SPELLS another server's old configured-name key — it is
          // still that other server's native id form, and an id is never reassigned to a
          // different server, so the kept original cannot over-block.
          // The original survives EVERY migration, takeover included. A catalog resolution is
          // never a complete recovery: every replacement derives from the spellings the
          // snapshot happens to hold, and camelization is not injective (`RUN`, `Run`, `rUn`
          // and `run` all fold to `run`), so a snapshot match on one spelling proves nothing
          // about the others the saved alias historically represented — the bounded
          // fold-class synthesis above covers only the conventional spellings. Dropping the
          // original on a takeover then removes the last rule the remount re-enforces (Pi
          // derives the configured-name alias from the raw tool, so the kept string binds
          // again the moment the owner remounts under its name, including onto its id while a
          // duplicate holds the name), and the explicitly disabled tool executes. The kept
          // string under a takeover spells the claimant's registered identity and can deny the
          // claimant's same-camelization tool in this server's place — that over-block is the
          // accepted direction of the two conflicting invariants: keeping may deny an allowed
          // tool (fail-closed), while dropping permits the explicitly disabled one — the
          // permission invariant this migration exists to preserve (the same fail-closed trade
          // every ambiguous resolution in this engine already takes).
          replacements = [...targets, ...foldClassTargets(matched, toolPart, serverPart, rawResolved)]
        } else if (lossyMatched && /_[0-9a-f]{12}$/.test(toolPart)) {
          replacements = [
            ...rewriteHashed(toolPart, lossyMatched.toKey),
            // The complete literal destinations, for the same reason as the matched branch
            // above: the truncated copies alone can clip a real literal tool name.
            ...targetForms(lossyMatched, toolPart, serverPart).targets
          ]
        }
      } else if (/_[0-9a-f]{12}$/.test(rest) && rest.length > 13) {
        // Truncated before the server/tool delimiter: the fused prefix is all that survives of
        // the key. A prefix match on the old key's camelized form identifies the owner (a key
        // that fit entirely would have kept the `__`); the fragment maps onto the new key's
        // equally truncated fragment, and the tail rides along for the prefix scan. A truncated
        // prefix cannot establish a unique owner — several old keys can share the camelized
        // prefix, and the first match's replacement may equal the original string (filtered out
        // below), silently dropping the rewrite of the server the denial actually follows. Every
        // prefix-matching rewrite emits its candidate copies (fail-closed); the final dedup
        // folds the duplicates.
        const fragment = rest.slice(0, rest.length - 13)
        const tail = rest.slice(rest.length - 13)
        const targets = new Set<string>()
        for (const { fromKey, toKey } of rewrites) {
          if (!toCamelCase(fromKey).startsWith(fragment)) continue
          targets.add(toCamelCase(toKey))
          if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(toKey)) targets.add(toKey)
        }
        if (targets.size > 0) {
          replacements = [...targets].map((target) => `mcp__${target.slice(0, fragment.length)}${tail}`)
        }
      }
    }
    return { entry, replacements: replacements?.filter((replacement) => replacement !== entry) ?? [] }
  })

  let changed = false
  const migrated: string[] = []
  const emitted = new Set<string>()
  for (const { entry, replacements } of planned) {
    const push = (value: string) => {
      if (emitted.has(value)) return
      emitted.add(value)
      migrated.push(value)
    }
    if (replacements.length === 0) {
      push(entry)
      continue
    }
    changed = true
    // The original always leads: it is the one restriction a partial catalog cannot replace
    // (see the matched branch above), and it can simultaneously be another server's exact
    // denial.
    push(entry)
    for (const replacement of replacements) push(replacement)
  }
  return changed ? migrated : undefined
}
