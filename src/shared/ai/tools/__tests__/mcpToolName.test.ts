import { describe, expect, it } from 'vitest'

import {
  buildFunctionCallToolName,
  buildMcpToolName,
  generateMcpToolFunctionName,
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
})

describe('translateMcpToolRulesToRuntimeNames', () => {
  const byId = new Map([['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Old server']])

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
})

describe('migrateDisabledToolsForServerRename', () => {
  it('rewrites saved denial rules from the old key onto the renamed key', () => {
    // `docs` renamed to `github`: the saved `mcp__docs__run` encodes the key of the moment and
    // would otherwise match nothing, letting the disabled tool execute under bypassPermissions.
    expect(migrateDisabledToolsForServerRename(['mcp__docs__run'], 'docs', 'github')).toEqual(['mcp__github__run'])
  })

  it('keeps the tool segment verbatim even when it contains `__`', () => {
    expect(migrateDisabledToolsForServerRename(['mcp__docs__x__y'], 'docs', 'github')).toEqual(['mcp__github__x__y'])
  })

  it('sanitizes both sides before matching and rewriting', () => {
    expect(migrateDisabledToolsForServerRename(['mcp__docs_search__run'], 'docs__search', 'my__server')).toEqual([
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
    // Renaming B to `github` rewrites B's id-keyed rule onto `github` and leaves A's `docs`
    // denial — and `other`'s — untouched.
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
    ).toEqual(['mcp__docs__run', 'mcp__github__run', 'mcp__other__run'])
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
    // resolves the copy onto the renamed pair.
    expect(
      migrateAgentDisabledToolsForServerRename(['mcp__oldServer__run_4f7413c24ae4', 'mcp__Old server__other'], {
        mountedServers: [{ mcpId: 'srv-1', name: 'Old server' }],
        renamedServerId: 'srv-1',
        toName: 'New server',
        reservedKeys: RESERVED
      })
    ).toEqual(['mcp__oldServer__run_4f7413c24ae4', 'mcp__newServer__run_4f7413c24ae4', 'mcp__New server__other'])
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
    ).toEqual([entry, `mcp__newServer__${longTool.slice(0, 34)}_4f7413c24ae4`])
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
    // B's tool executes under the identity A now owns.
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
    ).toEqual(['mcp__srv-b__run', 'mcp__other__run'])
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
    ).toEqual(['mcp__github__x', 'mcp__srv-b__run'])
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
    ).toEqual([entry, `mcp__github__${'a'.repeat(37)}_4f7413c24ae4`])
  })

  it('rewrites a displaced sibling hashed entry onto the sibling stripped base', () => {
    // B's denial was saved under a hashed runtime name keyed `github`; when A takes the key,
    // the copy must follow B's id key, not stay on A's new name.
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
    ).toEqual([entry, 'mcp__srv-b__run_4f7413c24ae4'])
  })
})
