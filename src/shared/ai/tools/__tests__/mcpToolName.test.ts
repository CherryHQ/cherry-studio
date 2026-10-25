import { describe, expect, it } from 'vitest'

import {
  allocateMountedServerKeys,
  buildFunctionCallToolName,
  buildMcpToolName,
  generateMcpToolFunctionName,
  migrateAgentDisabledToolsForAllocationChange,
  migrateAgentDisabledToolsForServerRename,
  migrateDisabledToolsForServerRename,
  parseFunctionCallToolName,
  toCamelCase,
  translateLegacyMcpToolRules,
  translateMcpToolRulesToRuntimeNames
} from '../mcpToolName'

describe('parseFunctionCallToolName', () => {
  it('splits a minted MCP id into server and tool parts', () => {
    expect(parseFunctionCallToolName('mcp__github__searchIssues')).toEqual({
      serverPart: 'github',
      toolPart: 'searchIssues'
    })
  })

  it('returns null for non-MCP and malformed names', () => {
    expect(parseFunctionCallToolName('Bash')).toBeNull()
    expect(parseFunctionCallToolName('mcp__github')).toBeNull()
    expect(parseFunctionCallToolName('mcp____tool')).toBeNull()
  })

  it('returns null for a missing name instead of throwing', () => {
    // Providers can open a tool_use block before the name is known.
    expect(parseFunctionCallToolName(undefined)).toBeNull()
  })
})

describe('toCamelCase', () => {
  it('should convert hyphenated strings', () => {
    expect(toCamelCase('my-server')).toBe('myServer')
    expect(toCamelCase('my-tool-name')).toBe('myToolName')
  })

  it('should convert underscored strings', () => {
    expect(toCamelCase('my_server')).toBe('myServer')
    expect(toCamelCase('search_issues')).toBe('searchIssues')
  })

  it('should handle mixed delimiters', () => {
    expect(toCamelCase('my-server_name')).toBe('myServerName')
  })

  it('should handle leading numbers by prefixing underscore', () => {
    expect(toCamelCase('123server')).toBe('_123server')
  })

  it('should handle special characters', () => {
    expect(toCamelCase('test@server!')).toBe('testServer')
    expect(toCamelCase('tool#name$')).toBe('toolName')
  })

  it('should trim whitespace', () => {
    expect(toCamelCase('  server  ')).toBe('server')
  })

  it('should handle empty string', () => {
    expect(toCamelCase('')).toBe('')
  })

  it('should handle uppercase snake case', () => {
    expect(toCamelCase('MY_SERVER')).toBe('myServer')
    expect(toCamelCase('SEARCH_ISSUES')).toBe('searchIssues')
  })

  it('should handle mixed case', () => {
    expect(toCamelCase('MyServer')).toBe('myserver')
    expect(toCamelCase('myTOOL')).toBe('mytool')
  })
})

describe('buildMcpToolName', () => {
  it('should build basic name with defaults', () => {
    expect(buildMcpToolName('github', 'search_issues')).toBe('github_searchIssues')
  })

  it('should handle undefined server name', () => {
    expect(buildMcpToolName(undefined, 'search_issues')).toBe('searchIssues')
  })

  it('should apply custom prefix and delimiter', () => {
    expect(buildMcpToolName('github', 'search', { prefix: 'mcp__', delimiter: '__' })).toBe('mcp__github__search')
  })

  it('should respect maxLength', () => {
    const result = buildMcpToolName('veryLongServerName', 'veryLongToolName', { maxLength: 20 })
    expect(result.length).toBeLessThanOrEqual(20)
  })

  it('should handle collision with existingNames', () => {
    const existingNames = new Set(['github_search'])
    const result = buildMcpToolName('github', 'search', { existingNames })
    expect(result).toBe('github_search1')
    expect(existingNames.has('github_search1')).toBe(true)
  })

  it('should respect maxLength when adding collision suffix', () => {
    const existingNames = new Set(['a'.repeat(20)])
    const result = buildMcpToolName('a'.repeat(20), '', { maxLength: 20, existingNames })
    expect(result.length).toBeLessThanOrEqual(20)
    expect(existingNames.has(result)).toBe(true)
  })

  it('should handle multiple collisions with maxLength', () => {
    const existingNames = new Set(['abcd', 'abc1', 'abc2'])
    const result = buildMcpToolName('abcd', '', { maxLength: 4, existingNames })
    expect(result).toBe('abc3')
    expect(result.length).toBeLessThanOrEqual(4)
  })
})

describe('generateMcpToolFunctionName', () => {
  it('should return format serverName_toolName in camelCase', () => {
    expect(generateMcpToolFunctionName('github', 'search_issues')).toBe('github_searchIssues')
  })

  it('should handle hyphenated names', () => {
    expect(generateMcpToolFunctionName('my-server', 'my-tool')).toBe('myServer_myTool')
  })

  it('should handle undefined server name', () => {
    expect(generateMcpToolFunctionName(undefined, 'search_issues')).toBe('searchIssues')
  })

  it('should handle collision detection', () => {
    const existingNames = new Set<string>()
    const first = generateMcpToolFunctionName('github', 'search', existingNames)
    const second = generateMcpToolFunctionName('github', 'search', existingNames)
    expect(first).toBe('github_search')
    expect(second).toBe('github_search1')
  })
})

describe('buildFunctionCallToolName', () => {
  describe('basic format', () => {
    it('should return format mcp__{server}__{tool} in camelCase', () => {
      const result = buildFunctionCallToolName('github', 'search_issues')
      expect(result).toBe('mcp__github__searchIssues')
    })

    it('should handle simple server and tool names', () => {
      expect(buildFunctionCallToolName('fetch', 'get_page')).toBe('mcp__fetch__getPage')
      expect(buildFunctionCallToolName('database', 'query')).toBe('mcp__database__query')
    })
  })

  describe('valid JavaScript identifier', () => {
    it('should always start with mcp__ prefix (valid JS identifier start)', () => {
      const result = buildFunctionCallToolName('123server', '456tool')
      expect(result).toMatch(/^mcp__/)
    })

    it('should handle hyphenated names with camelCase', () => {
      const result = buildFunctionCallToolName('my-server', 'my-tool')
      expect(result).toBe('mcp__myServer__myTool')
    })

    it('should be a valid JavaScript identifier', () => {
      const testCases = [
        ['github', 'create_issue'],
        ['my-server', 'fetch-data'],
        ['test@server', 'tool#name'],
        ['server.name', 'tool.action']
      ]

      for (const [server, tool] of testCases) {
        const result = buildFunctionCallToolName(server, tool)
        expect(result).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
      }
    })
  })

  describe('character sanitization', () => {
    it('should convert special characters to camelCase boundaries', () => {
      expect(buildFunctionCallToolName('my-server', 'my-tool-name')).toBe('mcp__myServer__myToolName')
      expect(buildFunctionCallToolName('test@server!', 'tool#name$')).toBe('mcp__testServer__toolName')
      expect(buildFunctionCallToolName('server.name', 'tool.action')).toBe('mcp__serverName__toolAction')
    })

    it('should handle spaces', () => {
      const result = buildFunctionCallToolName('my server', 'my tool')
      expect(result).toBe('mcp__myServer__myTool')
    })
  })

  describe('length constraints', () => {
    it('should not exceed 63 characters', () => {
      const longServerName = 'a'.repeat(50)
      const longToolName = 'b'.repeat(50)
      const result = buildFunctionCallToolName(longServerName, longToolName)
      expect(result.length).toBeLessThanOrEqual(63)
    })

    it('should not end with underscores after truncation', () => {
      const longServerName = 'a'.repeat(30)
      const longToolName = 'b'.repeat(30)
      const result = buildFunctionCallToolName(longServerName, longToolName)
      expect(result).not.toMatch(/_+$/)
      expect(result.length).toBeLessThanOrEqual(63)
    })

    it('mints distinct legacy ids for long server names with a shared prefix', () => {
      const serverA = `${'a'.repeat(60)}Alpha`
      const serverB = `${'a'.repeat(60)}Bravo`

      expect(buildFunctionCallToolName(serverA, 'toolX')).not.toBe(buildFunctionCallToolName(serverB, 'toolY'))
    })
  })

  describe('edge cases', () => {
    it('should handle empty server name', () => {
      const result = buildFunctionCallToolName('', 'tool')
      expect(result).toBe('mcp__tool')
    })

    it('should handle empty tool name', () => {
      const result = buildFunctionCallToolName('server', '')
      expect(result).toBe('mcp__server__')
    })

    it('should trim whitespace from names', () => {
      const result = buildFunctionCallToolName('  server  ', '  tool  ')
      expect(result).toBe('mcp__server__tool')
    })

    it('should handle mixed case by normalizing to lowercase first', () => {
      const result = buildFunctionCallToolName('MyServer', 'MyTool')
      expect(result).toBe('mcp__myserver__mytool')
    })

    it('should handle uppercase snake case', () => {
      const result = buildFunctionCallToolName('MY_SERVER', 'SEARCH_ISSUES')
      expect(result).toBe('mcp__myServer__searchIssues')
    })
  })

  describe('deterministic output', () => {
    it('should produce consistent results for same input', () => {
      const result1 = buildFunctionCallToolName('github', 'search_repos')
      const result2 = buildFunctionCallToolName('github', 'search_repos')
      expect(result1).toBe(result2)
    })

    it('should produce different results for different inputs', () => {
      const result1 = buildFunctionCallToolName('server1', 'tool')
      const result2 = buildFunctionCallToolName('server2', 'tool')
      expect(result1).not.toBe(result2)
    })
  })

  describe('real-world scenarios', () => {
    it('should handle GitHub MCP server', () => {
      expect(buildFunctionCallToolName('github', 'create_issue')).toBe('mcp__github__createIssue')
      expect(buildFunctionCallToolName('github', 'search_repositories')).toBe('mcp__github__searchRepositories')
    })

    it('should handle filesystem MCP server', () => {
      expect(buildFunctionCallToolName('filesystem', 'read_file')).toBe('mcp__filesystem__readFile')
      expect(buildFunctionCallToolName('filesystem', 'write_file')).toBe('mcp__filesystem__writeFile')
    })

    it('should handle hyphenated server names (common in npm packages)', () => {
      expect(buildFunctionCallToolName('cherry-fetch', 'get_page')).toBe('mcp__cherryFetch__getPage')
      expect(buildFunctionCallToolName('mcp-server-github', 'search')).toBe('mcp__mcpServerGithub__search')
    })

    it('should handle scoped npm package style names', () => {
      const result = buildFunctionCallToolName('@anthropic/mcp-server', 'chat')
      expect(result).toBe('mcp__AnthropicMcpServer__chat')
    })
  })
})

describe('translateLegacyMcpToolRules', () => {
  const byId = new Map([
    ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'github'],
    ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'docs__search']
  ])

  it('rewrites a legacy id-keyed rule to the current server key', () => {
    expect(translateLegacyMcpToolRules(['mcp__aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa__run'], byId)).toEqual([
      'mcp__github__run'
    ])
  })

  it('keeps the tool segment verbatim, including further __ separators', () => {
    expect(translateLegacyMcpToolRules(['mcp__bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb__deep__nested'], byId)).toEqual([
      'mcp__docs__search__deep__nested'
    ])
  })

  it('leaves name-form rules and unknown servers untouched', () => {
    expect(translateLegacyMcpToolRules(['mcp__github__run', 'mcp__ghost__run', 'Bash'], byId)).toEqual([
      'mcp__github__run',
      'mcp__ghost__run',
      'Bash'
    ])
  })

  it('passes through malformed rules and empty input', () => {
    expect(translateLegacyMcpToolRules(['mcp__', 'mcp__no-delimiter', ''], byId)).toEqual([
      'mcp__',
      'mcp__no-delimiter',
      ''
    ])
    expect(translateLegacyMcpToolRules(undefined, byId)).toEqual([])
    expect(translateLegacyMcpToolRules(null, byId)).toEqual([])
  })

  it('keeps a rule that is simultaneously another mounted server current form', () => {
    // A configured name can extend another server's id (`U__x`): the saved string is then both
    // B's current-form rule (key `U__x`, tool `y`) and A's legacy id form (id `U`, tool `x__y`).
    // Rewriting it away would strip B's explicit denial under an exact-match policy, so the
    // ambiguous rule emits both forms.
    const ambiguous = new Map([
      ['U', 'github'],
      ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'U__x']
    ])
    expect(translateLegacyMcpToolRules(['mcp__U__x__y'], ambiguous)).toEqual(['mcp__U__x__y', 'mcp__github__x__y'])
    // A legacy rule with no such overlap still rewrites exactly once.
    expect(translateLegacyMcpToolRules(['mcp__bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb__run'], ambiguous)).toEqual([
      'mcp__U__x__run'
    ])
  })

  it('normalizes the rewritten key onto the segment the Claude SDK actually invokes', () => {
    // The SDK derives tool names from the server record key by replacing only the characters
    // invalid in a Claude tool name with underscores: a space underscores (`Docs MCP` →
    // `Docs_MCP`) while hyphens survive verbatim (`my-tools` → `my-tools`). The live policy
    // must emit that form — an entry spelling the raw key with a space names a tool the SDK
    // never serves, so the exact-match denial silently lapses under Full Access.
    const withSpace = new Map([['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Docs MCP']])
    expect(translateLegacyMcpToolRules(['mcp__aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa__run'], withSpace)).toEqual([
      'mcp__Docs_MCP__run'
    ])
    const withHyphens = new Map([['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'my-tools']])
    expect(translateLegacyMcpToolRules(['mcp__aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa__run'], withHyphens)).toEqual([
      'mcp__my-tools__run'
    ])
    // A hyphenated id key is already a valid SDK segment: the rewrite folds onto the rule
    // itself and passes through unchanged.
    const hyphenated = new Map([['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']])
    expect(translateLegacyMcpToolRules(['mcp__aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa__run'], hyphenated)).toEqual([
      'mcp__aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa__run'
    ])
  })
})

describe('translateMcpToolRulesToRuntimeNames', () => {
  const byId = new Map([['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Old server']])

  it('resolves a rename-migrated truncated identity through the stripped-prefix scan', () => {
    // A 60-char key truncates the lossy DSH name before the `__`; rename migration can only
    // carry the fragment onto the new key's truncated form. The registered base of the new
    // pair extends that fragment, so the denial must resolve onto the executable name.
    const runtimeNames = new Map([['mcp__docs__run', ['mcp__docs__run']]])
    expect(translateMcpToolRulesToRuntimeNames([`mcp__docs_abc123def456`], new Map(), runtimeNames)).toEqual([
      'mcp__docs__run'
    ])
  })

  it('rewrites translated rules onto the bridge-registered runtime identity', () => {
    // `Old server` is not provider-safe: the executable tool carries the lossy hash suffix,
    // so the translated name-form rule must be replaced by the identity the bridge actually
    // registered — otherwise an exact-match policy misses the denial.
    const runtimeNames = new Map([['mcp__Old server__run', ['mcp__oldServer__run_4f7413c24ae4']]])
    expect(
      translateMcpToolRulesToRuntimeNames([`mcp__aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa__run`], byId, runtimeNames)
    ).toEqual(['mcp__oldServer__run_4f7413c24ae4'])
  })

  it('resolves an id-keyed rule onto its own pair when name-form strings collide', () => {
    // `docs` exposing `search__all` and `docs__search` exposing `all` both flatten to the
    // rule string `mcp__docs__search__all`; the id-keyed denial names one pair exactly and
    // must land on that pair's allocated name, never on the colliding sibling.
    const byIdPair = new Map([['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'docs']])
    const runtimeNames = new Map([
      ['docs\u0000search__all', ['mcp__docs__search__all']],
      ['docs__search\u0000all', ['mcp__docs__search__all_353988fff1e9']],
      ['mcp__docs__search__all', ['mcp__docs__search__all', 'mcp__docs__search__all_353988fff1e9']]
    ])
    expect(
      translateMcpToolRulesToRuntimeNames(
        [`mcp__aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa__search__all`],
        byIdPair,
        runtimeNames
      )
    ).toEqual(['mcp__docs__search__all'])
  })

  it('maps a flattened name-form rule onto every candidate identity (fail-closed)', () => {
    // A saved name-form denial cannot say which colliding pair it meant — denying both
    // candidates over-blocks instead of letting an explicitly disabled tool execute.
    const runtimeNames = new Map([
      ['mcp__docs__search__all', ['mcp__docs__search__all', 'mcp__docs__search__all_353988fff1e9']]
    ])
    expect(translateMcpToolRulesToRuntimeNames(['mcp__docs__search__all'], new Map(), runtimeNames)).toEqual([
      'mcp__docs__search__all',
      'mcp__docs__search__all_353988fff1e9'
    ])
  })

  it('rewrites name-form rules whose rule string matches a registered identity', () => {
    const runtimeNames = new Map([['mcp__docs__search__all', ['mcp__docs__search__all_353988fff1e9']]])
    expect(translateMcpToolRulesToRuntimeNames(['mcp__docs__search__all'], byId, runtimeNames)).toEqual([
      'mcp__docs__search__all_353988fff1e9'
    ])
  })

  it('keeps rules with no registered runtime identity unchanged', () => {
    expect(translateMcpToolRulesToRuntimeNames(['mcp__ghost__run', 'Bash'], byId, new Map())).toEqual([
      'mcp__ghost__run',
      'Bash'
    ])
  })

  // A configured server name can extend another mounted server's id (`U__x`): the saved denial
  // `mcp__U__x__y` is then simultaneously B's current name-form (key `U__x`, tool `y`) and A's
  // legacy id form (id `U`, tool `x__y`). The legacy rewrite must never strip the registered
  // candidates of the original string.
  it('preserves registered candidates when the id-prefix rewrite names another server', () => {
    const byIdPrefix = new Map([['U', 'github']])
    const runtimeNames = new Map([
      ['mcp__U__x__y', ['mcp__U__x__y']],
      ['U__x\u0000y', ['mcp__U__x__y']]
    ])
    expect(translateMcpToolRulesToRuntimeNames(['mcp__U__x__y'], byIdPrefix, runtimeNames)).toEqual(['mcp__U__x__y'])
  })

  it('merges both interpretations when the id-owner also exposes the flattened tool', () => {
    // A (id `U`, key `github`) exposes `x__y`: the pre-name id alias and B's name-form share the
    // string, and the pair match must not drop B — deny both (fail-closed).
    const byIdPrefix = new Map([['U', 'github']])
    const runtimeNames = new Map([
      ['mcp__U__x__y', ['mcp__U__x__y', 'mcp__github__x__y']],
      ['U__x\u0000y', ['mcp__U__x__y']],
      ['github\u0000x__y', ['mcp__github__x__y']]
    ])
    expect(translateMcpToolRulesToRuntimeNames(['mcp__U__x__y'], byIdPrefix, runtimeNames)).toEqual([
      'mcp__U__x__y',
      'mcp__github__x__y'
    ])
  })

  it("keeps the saved string's own candidates when the rewritten rule strips to a registered base", () => {
    // B (key `U__x`, tool `y_123456789abc`) has a runtime name whose tail parses as a
    // disambiguator. Saving it denies B exactly, but the legacy rewrite maps the string onto
    // A (id `U`, key `github`), and the rewritten string strips to A's registered name — that
    // stripped hit must merge with B's own registered candidates or B executes under
    // bypassPermissions despite the explicit denial.
    const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const savedDenial = `mcp__${U}__x__y_123456789abc`
    const byId = new Map([
      [U, 'github'],
      ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', `${U}__x`]
    ])
    const runtimeNames = new Map([
      [savedDenial, [savedDenial]],
      [`${U}__x\u0000y_123456789abc`, [savedDenial]],
      ['github\u0000x__y', ['mcp__github__x__y']],
      ['mcp__github__x__y', ['mcp__github__x__y']],
      [`mcp__${U}__x__y`, ['mcp__github__x__y']]
    ])
    expect(translateMcpToolRulesToRuntimeNames([savedDenial], byId, runtimeNames)).toEqual([
      'mcp__github__x__y',
      savedDenial
    ])
  })

  it('resolves a truncated fragment copy onto identities extending it after a shortening rename', () => {
    // A 53-char tool keyed `github` registers the lossy `mcp__github__` + 37 chars + hash (the
    // 50-char base). Renaming the server to the shorter `docs` makes the new lossy base keep 39
    // tool chars, so a copy carrying the 37-char fragment can never hit it exactly — the
    // stripped fragment is a strict prefix of the new base, and the registered identity
    // extending it must resolve (over-blocking beats an executable disabled tool).
    const lossyBase = `mcp__docs__${'a'.repeat(39)}`
    const runtimeName = `${lossyBase}_c0ffee123456`
    const map = new Map([[lossyBase, [runtimeName]]])
    const rule = `mcp__docs__${'a'.repeat(37)}_4f7413c24ae4`
    expect(translateMcpToolRulesToRuntimeNames([rule], new Map(), map)).toEqual([runtimeName])
  })

  it('merges extended identities even when the stripped fragment exactly hits a shorter tool', () => {
    // `github` exposes 53- and 37-character tools sharing a prefix: the long tool registers the
    // truncated `mcp__github__<37 a>_<hash>`. Renaming the server to `docs` keeps the denial's
    // stripped fragment exactly equal to the short tool's verbatim registration (`mcp__docs__`
    // holds 37 chars while the long tool's new lossy base holds 39) — returning the exact hit
    // alone skips the prefix scan and lets the explicitly disabled long tool execute.
    const shortName = `mcp__docs__${'a'.repeat(37)}`
    const longName = `mcp__docs__${'a'.repeat(39)}_c0ffee123456`
    const map = new Map([
      [shortName, [shortName]],
      [`mcp__docs__${'a'.repeat(39)}`, [longName]],
      [longName, [longName]]
    ])
    const rule = `mcp__docs__${'a'.repeat(37)}_4f7413c24ae4`
    expect(translateMcpToolRulesToRuntimeNames([rule], new Map(), map)).toEqual([shortName, longName])
  })

  it('does not prefix-scan rules without a disambiguator tail', () => {
    // A plain name-form miss is a rule for a server/tool that is not mounted: prefix-scanning
    // it would blanket-deny longer unrelated tools sharing the prefix.
    const lossyBase = `mcp__docs__${'a'.repeat(39)}`
    const map = new Map([[lossyBase, [`${lossyBase}_c0ffee123456`]]])
    const rule = `mcp__docs__${'a'.repeat(37)}`
    expect(translateMcpToolRulesToRuntimeNames([rule], new Map(), map)).toEqual([rule])
  })
})

describe('migrateDisabledToolsForServerRename', () => {
  it('rewrites saved denial rules from the old key onto the renamed key', () => {
    // `docs` renamed to `github`: the saved `mcp__docs__run` encodes the key of the moment and
    // would otherwise match nothing, letting the disabled tool execute under bypassPermissions.
    // Server-level rules feed matchesMcpSourceToolRule, where an entry may be either a literal
    // provider tool name (rename-independent) or the old wire form (rename-dependent) — the two
    // are indistinguishable, so the original stays alongside the migrated alias. These rules
    // only ever gate THIS server's tools, so the kept literal cannot block another server.
    expect(migrateDisabledToolsForServerRename(['mcp__docs__run'], 'docs', 'github')).toEqual([
      'mcp__docs__run',
      'mcp__github__run'
    ])
  })

  it('keeps the tool segment verbatim even when it contains `__`', () => {
    expect(migrateDisabledToolsForServerRename(['mcp__docs__x__y'], 'docs', 'github')).toEqual([
      'mcp__docs__x__y',
      'mcp__github__x__y'
    ])
  })

  it('sanitizes both sides before matching and rewriting', () => {
    expect(migrateDisabledToolsForServerRename(['mcp__docs_search__run'], 'docs__search', 'my__server')).toEqual([
      'mcp__docs_search__run',
      'mcp__my_server__run'
    ])
  })

  it('leaves other servers, id-keyed rules and non-mcp forms untouched', () => {
    expect(
      migrateDisabledToolsForServerRename(
        ['mcp__other__run', 'mcp__11111111-1111-4111-8111-111111111111__run', 'github_run', 'mcp____orphan'],
        'docs',
        'github'
      )
    ).toBeUndefined()
  })

  it('returns undefined for non-renames', () => {
    expect(migrateDisabledToolsForServerRename(['mcp__docs__run'], 'docs', 'docs')).toBeUndefined()
  })
})

describe('migrateAgentDisabledToolsForServerRename', () => {
  const RESERVED = ['skills', 'assistant', 'agent-memory']

  it('keeps a Pi display-name alias whose string becomes another server key after the rename', () => {
    // A (`other`) mounts first; B (`docs`) is displaced onto its id when A renames to `docs`.
    // The saved `mcp__docs__getTime` is B's Pi display-name alias — B's configured name did not
    // change, so Pi still resolves B's denial through it — while the rewritten id forms copy
    // the camelized tool fragment and can never regenerate it. The alias must survive.
    const migrated = migrateAgentDisabledToolsForServerRename(['mcp__docs__getTime'], {
      mountedServers: [
        { mcpId: 'srv-a', name: 'other' },
        { mcpId: 'srv-b', name: 'docs' }
      ],
      renamedServerId: 'srv-a',
      toName: 'docs',
      reservedKeys: RESERVED
    })
    expect(migrated).toContain('mcp__docs__getTime')
    expect(migrated).toContain('mcp__srv-b__getTime')
    expect(migrated).toContain('mcp__srv-b__gettime')
  })

  it('leaves rules alone when the agent does not mount the renamed server', () => {
    // Two servers named `docs` exist and the agent mounts neither `srv-b`: renaming `srv-b`
    // must not steal `mcp__docs__run`, which belongs to the mounted server or to nothing.
    expect(
      migrateAgentDisabledToolsForServerRename(['mcp__docs__run', 'mcp__other__run'], {
        mountedServers: [{ mcpId: 'srv-a', name: 'docs' }],
        renamedServerId: 'srv-b',
        toName: 'github',
        reservedKeys: RESERVED
      })
    ).toBeUndefined()
  })

  it('keeps the first claimant of a duplicate name and migrates only the renamed server', () => {
    // A and B are both named `docs`; A mounts first and claims `docs`, B falls back to its id.
    // Renaming B to `github` rewrites B's id-keyed rule onto `github` — keeping the raw id form
    // (Pi matches it verbatim at any length) — and leaves A's `docs` denial — and `other`'s —
    // untouched.
    expect(
      migrateAgentDisabledToolsForServerRename(['mcp__docs__run', 'mcp__srv-b__run', 'mcp__other__run'], {
        mountedServers: [
          { mcpId: 'srv-a', name: 'docs' },
          { mcpId: 'srv-b', name: 'docs' }
        ],
        renamedServerId: 'srv-b',
        toName: 'github',
        reservedKeys: RESERVED
      })
    ).toEqual(['mcp__docs__run', 'mcp__srv-b__run', 'mcp__github__run', 'mcp__other__run'])
  })

  it('rewrites onto the post-rename allocation, including the id fallback for reserved names', () => {
    // Renaming `docs` onto the reserved `skills` key: the allocator falls back to the server
    // id, so the saved rule must follow to `mcp__<id>__run`, not onto the unwritable name.
    expect(
      migrateAgentDisabledToolsForServerRename(['mcp__docs__run', 'mcp__other__run'], {
        mountedServers: [{ mcpId: 'srv-1', name: 'docs' }],
        renamedServerId: 'srv-1',
        toName: 'skills',
        reservedKeys: RESERVED
      })
    ).toEqual(['mcp__srv-1__run', 'mcp__other__run'])
  })

  it('keeps id-keyed rules that still resolve after a name-keyed fallback appears', () => {
    // Renaming into a name claimed by a sibling keeps the renamed server on its id; its saved
    // id-keyed rules already name the pair exactly and the key is unchanged.
    expect(
      migrateAgentDisabledToolsForServerRename(['mcp__srv-1__run'], {
        mountedServers: [
          { mcpId: 'srv-1', name: 'docs' },
          { mcpId: 'srv-2', name: 'github' }
        ],
        renamedServerId: 'srv-1',
        toName: 'github',
        reservedKeys: RESERVED
      })
    ).toBeUndefined()
  })

  it('copies lossy-hashed entries onto the new lossy base, keeping the original', () => {
    // `Old server` registers lossy (`mcp__oldServer__run_<hash>`); the hash binds the old pair,
    // so the rename copies the entry onto the new lossy base and keeps the original (which can
    // simultaneously be another server's exact denial). The runtime's stripped-base lookup
    // resolves the copy onto the renamed pair. Plain entries also carry the camelized
    // configured-name form Pi resolves denials through (`New server` → `newServer`) and the
    // SDK-normalized key form the SDK invokes (`New server` → `New_server`). A rule saved under
    // the raw spaced name (`mcp__Old server__other`) is a legacy form no allocator can produce
    // anymore — it passes through, and can only ever over-block.
    expect(
      migrateAgentDisabledToolsForServerRename(['mcp__oldServer__run_4f7413c24ae4', 'mcp__Old_server__other'], {
        mountedServers: [{ mcpId: 'srv-1', name: 'Old server' }],
        renamedServerId: 'srv-1',
        toName: 'New server',
        reservedKeys: RESERVED
      })
    ).toEqual([
      'mcp__oldServer__run_4f7413c24ae4',
      'mcp__newServer__run_4f7413c24ae4',
      'mcp__New_server__run_4f7413c24ae4',
      // The tail can also be a plain literal tool name, so the complete literal destination
      // (Pi's camelized-tool alias) rides along with the hashed copies.
      'mcp__newServer__run4f7413c24ae4',
      'mcp__New_server__other',
      'mcp__newServer__other'
    ])
  })

  it('truncates the copied lossy base to the allocator cap with the hash tail intact', () => {
    // A long tool name truncates the base at 50 chars; the copy must land on the same
    // truncated base the runtime indexes for the renamed pair.
    const longTool = 'a'.repeat(40)
    const entry = `mcp__oldServer__${longTool.slice(0, 34)}_4f7413c24ae4`
    expect(
      migrateAgentDisabledToolsForServerRename([entry], {
        mountedServers: [{ mcpId: 'srv-1', name: 'Old server' }],
        renamedServerId: 'srv-1',
        toName: 'New server',
        reservedKeys: RESERVED
      })
    ).toEqual([
      entry,
      `mcp__newServer__${longTool.slice(0, 34)}_4f7413c24ae4`,
      `mcp__New_server__${longTool.slice(0, 33)}_4f7413c24ae4`,
      // The literal interpretation keeps the fragment whole on both key forms.
      `mcp__New_server__${longTool.slice(0, 34)}_4f7413c24ae4`,
      `mcp__newServer__${longTool.slice(0, 34)}4f7413c24ae4`
    ])
  })

  it('returns undefined when nothing changed', () => {
    expect(
      migrateAgentDisabledToolsForServerRename(['mcp__other__run'], {
        mountedServers: [{ mcpId: 'srv-1', name: 'docs' }],
        renamedServerId: 'srv-1',
        toName: 'github',
        reservedKeys: RESERVED
      })
    ).toBeUndefined()
  })

  it('follows a sibling whose allocated key the rename displaces', () => {
    // A (`docs`) mounts before B (`github`); disabling B saved `mcp__github__run`. Renaming A
    // to `github` moves the key to A and bumps B onto its id — B's denial must follow B, or
    // B's tool executes under the identity A now owns. The original string also stays: B's
    // configured name is still `github`, so the string remains B's Pi display-name alias
    // (over-blocking A's identically-named tool is the fail-closed side).
    expect(
      migrateAgentDisabledToolsForServerRename(['mcp__github__run', 'mcp__other__run'], {
        mountedServers: [
          { mcpId: 'srv-a', name: 'docs' },
          { mcpId: 'srv-b', name: 'github' }
        ],
        renamedServerId: 'srv-a',
        toName: 'github',
        reservedKeys: RESERVED
      })
    ).toEqual(['mcp__github__run', 'mcp__srv-b__run', 'mcp__other__run'])
  })

  it('migrates the renamed server and a displaced sibling in one pass', () => {
    expect(
      migrateAgentDisabledToolsForServerRename(['mcp__docs__x', 'mcp__github__run'], {
        mountedServers: [
          { mcpId: 'srv-a', name: 'docs' },
          { mcpId: 'srv-b', name: 'github' }
        ],
        renamedServerId: 'srv-a',
        toName: 'github',
        reservedKeys: RESERVED
      })
    ).toEqual(['mcp__github__x', 'mcp__github__run', 'mcp__srv-b__run'])
  })

  it('rewrites a hashed plain-key entry onto the 50-char stripped base of the new allocation', () => {
    // A 53-char lowercase tool truncates before the hash (`mcp__docs__` + 39 chars + `_hash`).
    // Carrying the fragment into the longer `github` prefix matches neither the new runtime
    // name nor its stripped base; the copy must land on the truncated 50-char base the runtime
    // indexes for the renamed pair.
    const entry = `mcp__docs__${'a'.repeat(39)}_4f7413c24ae4`
    expect(
      migrateAgentDisabledToolsForServerRename([entry], {
        mountedServers: [{ mcpId: 'srv-1', name: 'docs' }],
        renamedServerId: 'srv-1',
        toName: 'github',
        reservedKeys: RESERVED
      })
    ).toEqual([
      entry,
      `mcp__github__${'a'.repeat(37)}_4f7413c24ae4`,
      // The literal interpretation keeps all 39 `a`s on the raw and camelized-tool forms.
      `mcp__github__${'a'.repeat(39)}_4f7413c24ae4`,
      `mcp__github__${'a'.repeat(39)}4f7413c24ae4`
    ])
  })

  it('keeps a literal tool name whose tail parses as a hash intact on the renamed key', () => {
    // A literal tool name can end in `_12hex` (here 38 `a`s + `_123456789abc`; the renamed key
    // makes the full identity exactly 64 characters, which the pinned SDK serves in full). The
    // suffix test alone cannot tell it from a legacy hashed identity, so the migration must keep
    // the complete literal destination alongside the truncated hashed copies — truncating the
    // fragment to the 50-char base drops the 38th `a`, and neither persisted rule matches the
    // runtime name, re-enabling the explicitly disabled tool.
    const tool = `${'a'.repeat(38)}_123456789abc`
    const entry = `mcp__docs__${tool}`
    expect(
      migrateAgentDisabledToolsForServerRename([entry], {
        mountedServers: [{ mcpId: 'srv-1', name: 'docs' }],
        renamedServerId: 'srv-1',
        toName: 'github',
        reservedKeys: RESERVED
      })
    ).toEqual([
      entry,
      `mcp__github__${'a'.repeat(37)}_123456789abc`,
      `mcp__github__${tool}`,
      `mcp__github__${'a'.repeat(38)}123456789abc`
    ])
  })

  it('rewrites a displaced sibling hashed entry onto the sibling stripped base', () => {
    // B's denial was saved under a hashed runtime name keyed `github`; when A takes the key,
    // the copy must follow B's id key, not stay on A's new name. Both key forms are copied
    // (camelized first, raw second): the camelized copy strips onto the lossy base the bridge
    // indexes for the pair, the raw copy heads the plain name-form.
    const entry = 'mcp__github__run_4f7413c24ae4'
    expect(
      migrateAgentDisabledToolsForServerRename([entry], {
        mountedServers: [
          { mcpId: 'srv-a', name: 'docs' },
          { mcpId: 'srv-b', name: 'github' }
        ],
        renamedServerId: 'srv-a',
        toName: 'github',
        reservedKeys: RESERVED
      })
    ).toEqual([entry, 'mcp__srvB__run_4f7413c24ae4', 'mcp__srv-b__run_4f7413c24ae4', 'mcp__srv-b__run4f7413c24ae4'])
  })

  it('copies lossy-hashed entries onto both raw and camelized forms of a wire-safe destination', () => {
    // `Old server`/`get_time` registers the lossy `mcp__oldServer__getTime_<hash>`; renaming to
    // the wire-safe mixed-case `GitHub` registers the plain `mcp__GitHub__get_time`. The
    // raw-target copy keeps heading that name-form, and the camelized copy strips onto the
    // lossy base the bridge indexes for normalized pairs — either interpretation alone lets
    // the explicitly disabled tool execute under the missed registration.
    expect(
      migrateAgentDisabledToolsForServerRename(['mcp__oldServer__getTime_4f7413c24ae4'], {
        mountedServers: [{ mcpId: 'srv-1', name: 'Old server' }],
        renamedServerId: 'srv-1',
        toName: 'GitHub',
        reservedKeys: RESERVED
      })
    ).toEqual([
      'mcp__oldServer__getTime_4f7413c24ae4',
      'mcp__github__getTime_4f7413c24ae4',
      'mcp__GitHub__getTime_4f7413c24ae4',
      // The literal interpretation also carries Pi's camelized-tool alias.
      'mcp__github__gettime4f7413c24ae4'
    ])
  })

  it('keeps every replacement when another original occupies its destination', () => {
    // A (`docs`) mounts before B (`github`); both run tools are disabled. Renaming A to
    // `github` hands the `github` key to A and bumps B onto its id. Deduping replacements
    // against the ORIGINAL list suppresses A's replacement (B's original occupies it) while
    // B's original itself moves away — leaving A's executable `mcp__github__run` undenied.
    // All rewrites must be planned first and the final output deduped afterwards.
    expect(
      migrateAgentDisabledToolsForServerRename(['mcp__docs__run', 'mcp__github__run'], {
        mountedServers: [
          { mcpId: 'srv-a', name: 'docs' },
          { mcpId: 'srv-b', name: 'github' }
        ],
        renamedServerId: 'srv-a',
        toName: 'github',
        reservedKeys: RESERVED
      })
    ).toEqual(['mcp__github__run', 'mcp__srv-b__run'])
  })

  it('emits the camelized configured-name form Pi recognizes after a mixed-case rename', () => {
    // A UUID-backed server named `skills` (reserved) keeps its denial under the raw id form;
    // after renaming to `GitHub` the runtime registers `mcp__GitHub__run`, but Pi resolves
    // denials through the camelized configured name (`mcp__github__run`) — without that alias
    // in the list the explicitly disabled tool executes on Pi. The raw id form stays: Pi
    // registers servers under their id and matches it verbatim at any tool length.
    expect(
      migrateAgentDisabledToolsForServerRename(['mcp__srv-1__run'], {
        mountedServers: [{ mcpId: 'srv-1', name: 'skills' }],
        renamedServerId: 'srv-1',
        toName: 'GitHub',
        reservedKeys: RESERVED
      })
    ).toEqual(['mcp__srv-1__run', 'mcp__GitHub__run', 'mcp__github__run'])
  })

  it('camelizes the tool segment of the alias Pi recognizes after a mixed-case rename', () => {
    // Pi resolves denials through `buildFunctionCallToolName`, which camelizes BOTH segments:
    // `GitHub` + `get_time` registers `mcp__github__getTime`. Copying the raw tool segment onto
    // the camelized key emits `mcp__github__get_time`, which matches nothing — a UUID-keyed
    // denial for a snake_case tool silently stops blocking after the rename.
    expect(
      migrateAgentDisabledToolsForServerRename(['mcp__srv-1__get_time'], {
        mountedServers: [{ mcpId: 'srv-1', name: 'skills' }],
        renamedServerId: 'srv-1',
        toName: 'GitHub',
        reservedKeys: RESERVED
      })
    ).toEqual(['mcp__srv-1__get_time', 'mcp__GitHub__get_time', 'mcp__github__getTime'])
  })

  it('emits the camelized-tool alias even when the destination key is already camelCase', () => {
    // Renaming the UUID-keyed `skills` onto a plain lowercase name (`docs`) needs no key
    // camelization, but Pi still registers `buildFunctionCallToolName('docs', 'get_time')` as
    // `mcp__docs__getTime`. The raw-form copy matches neither that identity nor the UUID alias
    // the migration replaces, so the tool executes on Pi after reconnect.
    expect(
      migrateAgentDisabledToolsForServerRename(['mcp__srv-1__get_time'], {
        mountedServers: [{ mcpId: 'srv-1', name: 'skills' }],
        renamedServerId: 'srv-1',
        toName: 'docs',
        reservedKeys: RESERVED
      })
    ).toEqual(['mcp__srv-1__get_time', 'mcp__docs__get_time', 'mcp__docs__getTime'])
  })

  it('carries a truncated DSH identity onto the renamed key fragment', () => {
    // A 60-char lowercase server name truncates the lossy DSH runtime name before the `__`
    // delimiter, fusing key and tool into one unparseable prefix. The saved denial must still
    // be recognized as the old key's truncation and rewritten onto the new key's fragment —
    // the enforcement lookup's stripped-prefix scan resolves it onto the new identity from
    // there.
    const entry = `mcp__${'a'.repeat(45)}_abc123def456`
    expect(
      migrateAgentDisabledToolsForServerRename([entry, 'mcp__other__run'], {
        mountedServers: [{ mcpId: 'srv-1', name: 'a'.repeat(60) }],
        renamedServerId: 'srv-1',
        toName: 'docs',
        reservedKeys: RESERVED
      })
    ).toEqual([entry, 'mcp__docs_abc123def456', 'mcp__other__run'])
  })

  it('follows every plausible owner when a truncated prefix matches several rewrites', () => {
    // A and B hold 60-char keys sharing the first 45 characters, and B's truncated DSH denial
    // survives as exactly that prefix. Renaming A onto B's name displaces B onto its id, and
    // BOTH old keys' camelized forms start with the retained fragment — a truncated prefix
    // cannot establish a unique owner. Taking the first match (A) emits a replacement equal to
    // the original, which the dedup filter drops, so migration returns undefined and B's
    // UUID-keyed tool executes. Every matching rewrite must emit its candidate copies.
    const prefix = 'a'.repeat(45)
    const entry = `mcp__${prefix}_abc123def456`
    expect(
      migrateAgentDisabledToolsForServerRename([entry], {
        mountedServers: [
          { mcpId: 'srv-a', name: `${prefix}${'b'.repeat(15)}` },
          { mcpId: 'srv-b', name: `${prefix}${'c'.repeat(15)}` }
        ],
        renamedServerId: 'srv-a',
        toName: `${prefix}${'c'.repeat(15)}`,
        reservedKeys: RESERVED
      })
    ).toEqual([entry, 'mcp__srvB_abc123def456', 'mcp__srv-b_abc123def456'])
  })

  it('keeps a denial that doubles as another mounted server native id identity', () => {
    // A's configured name equals B's id in Pi's registered segment form (hyphens underscored),
    // so A claims that key while Pi still registers B under `mcp__<b id underscored>__run`
    // verbatim. Disabling B saved that native identity; renaming A must migrate A's rule but
    // keep the string — it is B's registered name, and dropping it re-enables B's tool on Pi.
    const idB = 'cccccccc-dddd-4eee-8fff-000000000000'
    const piForm = idB.replace(/-/g, '_')
    const saved = `mcp__${piForm}__run`
    expect(
      migrateAgentDisabledToolsForServerRename([saved], {
        mountedServers: [
          { mcpId: 'srv-a', name: piForm },
          { mcpId: idB, name: 'bee' }
        ],
        renamedServerId: 'srv-a',
        toName: 'other',
        reservedKeys: RESERVED
      })
    ).toEqual([saved, 'mcp__other__run'])
  })

  it('emits the SDK-normalized destination identity when the new key needs underscoring', () => {
    // Renaming to `Docs MCP` allocates the protected key `Docs_MCP` (the space underscores and
    // the SDK invokes `mcp__Docs_MCP__run`); the copy list carries that identity plus the
    // camelized configured-name alias Pi resolves denials through.
    expect(
      migrateAgentDisabledToolsForServerRename(['mcp__docs__run'], {
        mountedServers: [{ mcpId: 'srv-1', name: 'docs' }],
        renamedServerId: 'srv-1',
        toName: 'Docs MCP',
        reservedKeys: RESERVED
      })
    ).toEqual(['mcp__Docs_MCP__run', 'mcp__docsMcp__run'])
  })

  it('recognizes a saved SDK-normalized key form as the renamed server on a subsequent rename', () => {
    // A prior migration persisted the SDK form (`Docs_MCP` for the key `Docs MCP`); renaming
    // again must treat that segment as the renamed server's rule, or the denial passes through
    // unmigrated and keeps pointing at the dead key.
    expect(
      migrateAgentDisabledToolsForServerRename(['mcp__Docs_MCP__run'], {
        mountedServers: [{ mcpId: 'srv-1', name: 'Docs MCP' }],
        renamedServerId: 'srv-1',
        toName: 'github',
        reservedKeys: RESERVED
      })
    ).toEqual(['mcp__github__run'])
  })
})

describe('migrateAgentDisabledToolsForAllocationChange', () => {
  const RESERVED = ['skills', 'assistant', 'agent-memory']
  const idA = '11111111-2222-3333-4444-555555555555'
  const idB = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

  it('follows a mounted server displaced onto its id by a new mount reserving the shared name', () => {
    // A's configured name equals unmounted B's id, so A's key is that id and disabling A.run
    // saved `mcp__<B id>__run`. Mounting B (name `other`) reserves B's id and moves A onto A's
    // id — the denial must follow A, or A's tool executes while B's run is blocked in its
    // place (the saved string resolves through B's pre-name alias).
    expect(
      migrateAgentDisabledToolsForAllocationChange([`mcp__${idB}__run`], {
        oldMountedServers: [{ mcpId: idA, name: idB }],
        newMountedServers: [
          { mcpId: idA, name: idB },
          { mcpId: idB, name: 'other' }
        ],
        reservedKeys: RESERVED
      })
    ).toEqual([`mcp__${idA}__run`])
  })

  it('returns undefined when the allocation is stable across the mount change', () => {
    expect(
      migrateAgentDisabledToolsForAllocationChange(['mcp__other__run'], {
        oldMountedServers: [{ mcpId: idA, name: 'docs' }],
        newMountedServers: [
          { mcpId: idA, name: 'docs' },
          { mcpId: idB, name: 'github' }
        ],
        reservedKeys: RESERVED
      })
    ).toBeUndefined()
  })

  it('reserves a non-candidate id per set so a server named after it is displaced like the runtime does', () => {
    // The runtime reserves the in-memory browser's id BEFORE skipping the browser
    // (resolveMountedAgentMcpServers): a server named after that id holds the id before the
    // change and falls back to its own id once the browser mounts. The migration must see the
    // same displacement — the browser never becomes a candidate (it registers nothing), but its
    // id joins the new set's reservations. Without it the allocation reads stable and the saved
    // denial stays keyed by an identity no runtime registers.
    expect(
      migrateAgentDisabledToolsForAllocationChange([`mcp__${idB}__run`], {
        oldMountedServers: [{ mcpId: idA, name: idB }],
        newMountedServers: [
          { mcpId: idB, name: '@cherry/browser' },
          { mcpId: idA, name: idB }
        ],
        reservedKeys: RESERVED,
        nonCandidateIds: new Set([idB])
      })
    ).toEqual([`mcp__${idA}__run`])
  })

  it('keeps the UUID denial and emits the camelized alias when unmounting promotes an id-keyed server to a mixed-case key', () => {
    // A and B are both named `GitHub`; B mounts second so its denial was saved under the raw id
    // form (`mcp__<idB>__run`). Unmounting A frees the name and B's allocation moves onto it.
    // Pi registers servers under their id and matches the raw `mcp__<id>__tool` alias verbatim,
    // so dropping the original re-enables the explicitly disabled tool on Pi; Pi also resolves
    // through `buildFunctionCallToolName('GitHub', 'run')` (`mcp__github__run`), which the
    // replacement must carry now that the destination key camelizes differently.
    const saved = `mcp__${idB}__run`
    expect(
      migrateAgentDisabledToolsForAllocationChange([saved], {
        oldMountedServers: [
          { mcpId: idA, name: 'GitHub' },
          { mcpId: idB, name: 'GitHub' }
        ],
        newMountedServers: [{ mcpId: idB, name: 'GitHub' }],
        reservedKeys: RESERVED
      })
    ).toEqual([saved, `mcp__GitHub__run`, `mcp__github__run`])
  })

  it('keeps a long raw UUID alias regardless of tool length because Pi matches the id form verbatim', () => {
    // Pi's serverId check (`mcp__<id>__<tool.name>`) has no length cap, so a long tool's saved
    // id-form denial blocks at any length; the migrated replacements cannot regenerate that
    // bounded identity (the full tool name is unrecoverable past the runtime's truncation), so
    // the original must survive the migration.
    const saved = `mcp__${idB}__${'a'.repeat(60)}`
    expect(
      migrateAgentDisabledToolsForAllocationChange([saved], {
        oldMountedServers: [
          { mcpId: idA, name: 'GitHub' },
          { mcpId: idB, name: 'GitHub' }
        ],
        newMountedServers: [{ mcpId: idB, name: 'GitHub' }],
        reservedKeys: RESERVED
      })
    ).toEqual([saved, `mcp__GitHub__${'a'.repeat(60)}`, `mcp__github__${'a'.repeat(60)}`])
  })
})

describe('allocateMountedServerKeys', () => {
  it('derives the key from the final SDK-normalized namespace', () => {
    // `docs  search` normalizes to the SDK segment `docs__search`, whose `__` would fuse onto
    // the `docs` + `search__all` callable — delimiter protection must apply to the FINAL
    // normalized form, so the key folds to `docs_search`.
    const keys = allocateMountedServerKeys(
      [
        { mcpId: 'id-a', name: 'docs' },
        { mcpId: 'id-b', name: 'docs  search' }
      ],
      []
    )
    expect(keys.get('id-a')).toBe('docs')
    expect(keys.get('id-b')).toBe('docs_search')
  })

  it('falls back to the id when another claim collapses into the same SDK namespace', () => {
    // `Docs MCP` and `Docs_MCP` fold onto the same protected key `Docs_MCP`: the SDK
    // underscores the space and the protection cannot split what normalization joined, so one
    // server's tools would be unreachable — the later claim must fall back to its id.
    const keys = allocateMountedServerKeys(
      [
        { mcpId: 'id-a', name: 'Docs MCP' },
        { mcpId: 'id-b', name: 'Docs_MCP' }
      ],
      ['skills', 'assistant', 'agent-memory']
    )
    expect(keys.get('id-a')).toBe('Docs_MCP')
    expect(keys.get('id-b')).toBe('id-b')
  })

  it('keeps hyphenated names distinct and lets an identifier-safe duplicate claim in raw form', () => {
    // Hyphens survive the SDK's tool-name derivation verbatim, so `my-tools` and `my_tools`
    // stay distinct callables; only forms that truly normalize together collide.
    const keys = allocateMountedServerKeys(
      [
        { mcpId: 'id-a', name: 'my-tools' },
        { mcpId: 'id-b', name: 'my_tools' }
      ],
      []
    )
    expect(keys.get('id-a')).toBe('my-tools')
    expect(keys.get('id-b')).toBe('my_tools')
  })
})
