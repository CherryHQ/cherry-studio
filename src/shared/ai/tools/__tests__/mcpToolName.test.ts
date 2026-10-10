import { describe, expect, it } from 'vitest'

import {
  buildFunctionCallToolName,
  buildMcpToolName,
  generateMcpToolFunctionName,
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
})

describe('translateMcpToolRulesToRuntimeNames', () => {
  const byId = new Map([['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Old server']])

  it('rewrites translated rules onto the bridge-registered runtime identity', () => {
    // `Old server` is not provider-safe: the executable tool carries the lossy hash suffix,
    // so the translated name-form rule must be replaced by the identity the bridge actually
    // registered — otherwise an exact-match policy misses the denial.
    const runtimeNames = new Map([['mcp__Old server__run', 'mcp__oldServer__run_4f7413c24ae4']])
    expect(
      translateMcpToolRulesToRuntimeNames([`mcp__aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa__run`], byId, runtimeNames)
    ).toEqual(['mcp__oldServer__run_4f7413c24ae4'])
  })

  it('rewrites name-form rules whose rule string matches a registered identity', () => {
    const runtimeNames = new Map([['mcp__docs__search__all', 'mcp__docs__search__all_353988fff1e9']])
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
})
