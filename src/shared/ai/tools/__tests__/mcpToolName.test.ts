import { describe, expect, it } from 'vitest'

import {
  buildFunctionCallToolName,
  buildMcpToolName,
  generateMcpToolFunctionName,
  isFunctionCallToolNameForServer,
  toCamelCase
} from '../mcpToolName'

describe('isFunctionCallToolNameForServer', () => {
  it('matches a normal minted id back to its server', () => {
    const id = buildFunctionCallToolName('github', 'search_issues')
    expect(id).toBe('mcp__github__searchIssues')
    expect(isFunctionCallToolNameForServer('github', id)).toBe(true)
  })

  it('does not let a shorter server name claim a longer server id', () => {
    const id = buildFunctionCallToolName('github', 'search_issues')
    // The trailing `__` delimiter keeps `git` from prefix-matching `github`.
    expect(isFunctionCallToolNameForServer('git', id)).toBe(false)
  })

  it('does not match an unrelated server', () => {
    const id = buildFunctionCallToolName('github', 'search_issues')
    expect(isFunctionCallToolNameForServer('gitlab', id)).toBe(false)
  })

  // ── Regression: 63-char truncation drops the `__` delimiter (tools-mcp-meta-4) ──
  it('matches a minted id whose server segment is long enough to truncate the delimiter', () => {
    const serverName = 's'.repeat(56) // camelCase length 56 → `mcp__` + 56 + `__` = 63
    const id = buildFunctionCallToolName(serverName, 'doThing')

    // The minted id has the trailing delimiter stripped, so the untruncated
    // prefix the old code reconstructed is NOT a prefix of it.
    const untruncatedPrefix = `mcp__${toCamelCase(serverName)}__`
    expect(id.startsWith(untruncatedPrefix)).toBe(false)

    // The fixed matcher still recognises the id as belonging to this server.
    expect(isFunctionCallToolNameForServer(serverName, id)).toBe(true)
  })

  it('matches a minted id whose server segment is itself clipped by the cap', () => {
    const serverName = 'x'.repeat(80) // `mcp__` + 80 > 63 → server segment is clipped
    const id = buildFunctionCallToolName(serverName, 'anything')
    expect(isFunctionCallToolNameForServer(serverName, id)).toBe(true)
  })

  it('round-trips every minted id to its own server across the truncation boundary', () => {
    const lengths = [3, 10, 54, 55, 56, 57, 58, 59, 60, 70]
    for (const len of lengths) {
      const serverName = 'a'.repeat(len)
      // Differ only at the tail — past the 63-char clip for long names. The minted
      // id's server-derived suffix hashes the *full* name, so the sibling is still
      // rejected even when the literal difference doesn't survive truncation.
      const sibling = `${'a'.repeat(len - 1)}b`
      const id = buildFunctionCallToolName(serverName, 'tool')
      expect(isFunctionCallToolNameForServer(serverName, id), `len=${len} owns its id`).toBe(true)
      expect(isFunctionCallToolNameForServer(sibling, id), `len=${len} sibling rejects it`).toBe(false)
    }
  })

  // ── Regression: cross-server over-match for tail-differing long names (tools-mcp-meta-4) ──
  it('mints distinct ids for distinct servers sharing a long camelCase prefix', () => {
    const serverA = `${'a'.repeat(60)}Alpha`
    const serverB = `${'a'.repeat(60)}Bravo`
    const idA = buildFunctionCallToolName(serverA, 'toolX')
    const idB = buildFunctionCallToolName(serverB, 'toolY')
    // Without the server-derived suffix these collapsed to the same truncated id.
    expect(idA).not.toBe(idB)
  })

  it('does not over-match a tail-differing sibling whose difference is past the clip', () => {
    const serverA = `${'a'.repeat(60)}Alpha`
    const serverB = `${'a'.repeat(60)}Bravo`
    const idA = buildFunctionCallToolName(serverA, 'toolX')

    expect(isFunctionCallToolNameForServer(serverA, idA)).toBe(true)
    expect(isFunctionCallToolNameForServer(serverB, idA)).toBe(false)
  })

  it('does not match a non-mcp tool id', () => {
    expect(isFunctionCallToolNameForServer('github', 'web_search')).toBe(false)
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
