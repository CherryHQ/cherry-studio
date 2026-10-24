import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({ default: { existsSync: vi.fn(() => false) } }))

import fs from 'node:fs'

import { planClaudeMcpToolNames } from '@main/ai/mcp/mcpToolNames'
import { buildClaudeMcpToolName, buildClaudeMcpWildcard } from '@shared/ai/claudecode/toolRules'

const mocks = vi.hoisted(() => ({ findServer: vi.fn(), listTools: vi.fn() }))
vi.mock('@data/services/McpServerService', () => ({ mcpServerService: { findByIdOrName: mocks.findServer } }))
vi.mock('@application', () => ({ application: { get: () => ({ listTools: mocks.listTools }) } }))

import { resolveDisallowedTools } from '../toolConditions'

const existsSync = vi.mocked(fs.existsSync)

beforeEach(() => {
  existsSync.mockReset()
  existsSync.mockReturnValue(false)
})

describe('resolveDisallowedTools', () => {
  it('disables every disabled-exposure tool with no overrides or ctx', () => {
    const disallowed = new Set(resolveDisallowedTools({}))
    // Parity with the former GLOBALLY_DISALLOWED_TOOLS set.
    expect(disallowed.has('WebSearch')).toBe(true)
    expect(disallowed.has('WebFetch')).toBe(true)
    expect(disallowed.has('TodoWrite')).toBe(true)
    // Newly disabled per the registry classification.
    expect(disallowed.has('NotebookEdit')).toBe(true)
    expect(disallowed.has('REPL')).toBe(true)
    expect(disallowed.has('CronCreate')).toBe(true)
    expect(disallowed.has('Monitor')).toBe(true)
    // user / internal tools are not disabled by default.
    expect(disallowed.has('Bash')).toBe(false)
    expect(disallowed.has('Read')).toBe(false)
    expect(disallowed.has('Workflow')).toBe(false)
    expect(disallowed.has('Agent')).toBe(false)
  })

  it('disables a user tool and its dependents (BashOutput follows Bash)', () => {
    const disallowed = new Set(resolveDisallowedTools({ disabledTools: ['Bash'] }))
    expect(disallowed.has('Bash')).toBe(true)
    expect(disallowed.has('BashOutput')).toBe(true)
  })

  it('honors user opt-outs for notify and config autonomy tools', () => {
    const disallowed = new Set(
      resolveDisallowedTools({ disabledTools: ['mcp__cherry-tools__notify', 'mcp__cherry-tools__config'] })
    )
    expect(disallowed.has('mcp__cherry-tools__notify')).toBe(true)
    expect(disallowed.has('mcp__cherry-tools__config')).toBe(true)
  })

  it('disabling the "Knowledge Search" toggle also revokes kb_list and kb_read (they dependsOn kb_search)', () => {
    // kb_read returns whole documents and kb_list browses every base — strictly more than kb_search's
    // chunks — so the visible kb_search toggle must honestly cover them, not leave read access reachable.
    const enabled = new Set(resolveDisallowedTools({}))
    expect(enabled.has('mcp__cherry-tools__kb_list')).toBe(false)
    expect(enabled.has('mcp__cherry-tools__kb_read')).toBe(false)

    const disallowed = new Set(resolveDisallowedTools({ disabledTools: ['mcp__cherry-tools__kb_search'] }))
    expect(disallowed.has('mcp__cherry-tools__kb_search')).toBe(true)
    expect(disallowed.has('mcp__cherry-tools__kb_list')).toBe(true)
    expect(disallowed.has('mcp__cherry-tools__kb_read')).toBe(true)
    // kb_manage has its own toggle and is independent of the search toggle.
    expect(disallowed.has('mcp__cherry-tools__kb_manage')).toBe(false)
  })

  it('ignores a disabledTools entry for a non-user tool', () => {
    const base = new Set(resolveDisallowedTools({}))
    const withAgent = new Set(resolveDisallowedTools({ disabledTools: ['Agent'] }))
    expect(withAgent).toEqual(base)
  })

  it('passes external MCP disabled entries through to the SDK disallowedTools list', () => {
    const disallowed = new Set(
      resolveDisallowedTools({ disabledTools: ['mcp__docs__search_docs', 'mcp__docs__*', 'Agent'] })
    )

    expect(disallowed.has('mcp__docs__search_docs')).toBe(true)
    expect(disallowed.has('mcp__docs__*')).toBe(true)
    expect(disallowed.has('Agent')).toBe(false)
  })

  it('treats predicate-gated tools as enabled when no ctx is supplied', () => {
    const disallowed = new Set(resolveDisallowedTools({}))
    expect(disallowed.has('EnterWorktree')).toBe(false)
    expect(disallowed.has('mcp__cherry-tools__notify')).toBe(false)
  })

  it('disables worktree tools without .git but keeps notify available (self-degrades when no channels)', () => {
    existsSync.mockReturnValue(false) // no .git
    const disallowed = new Set(resolveDisallowedTools({}, { cwd: '/ws' }))
    expect(disallowed.has('EnterWorktree')).toBe(true)
    expect(disallowed.has('ExitWorktree')).toBe(true)
    // notify is no longer channel-gated: it reports "no connected channels" at call time instead of
    // being hard-disabled, so an agent can add its first channel and notify in the same session.
    expect(disallowed.has('mcp__cherry-tools__notify')).toBe(false)
    expect(disallowed.has('mcp__cherry-tools__config')).toBe(false)
  })

  it('enables worktree tools with .git and keeps notify/config available', () => {
    existsSync.mockReturnValue(true) // .git present
    const disallowed = new Set(resolveDisallowedTools({}, { cwd: '/ws' }))
    expect(disallowed.has('EnterWorktree')).toBe(false)
    expect(disallowed.has('ExitWorktree')).toBe(false)
    expect(disallowed.has('mcp__cherry-tools__notify')).toBe(false)
    expect(disallowed.has('mcp__cherry-tools__config')).toBe(false)
  })
})

describe('bounded MCP disable rules', () => {
  const id = '12345678-1234-4234-8234-123456789abc'
  const server = { id, name: 'User MCP' }
  const alias = (name: string, key = id, serverId = id) => {
    const plan = planClaudeMcpToolNames({ serverId, sdkServerKey: key }, [name])
    return `mcp__${plan.serverKey}__${plan.toolName(name)}`
  }
  const externalRules = (rules: string[], mounts = [id]) =>
    resolveDisallowedTools({ disabledTools: rules, mcps: mounts }, undefined, true).filter(
      (rule) => !resolveDisallowedTools({}).includes(rule)
    )

  beforeEach(() => {
    mocks.findServer.mockReset().mockReturnValue(server)
    mocks.listTools.mockReset().mockReturnValue([{ name: 'read_file' }, { name: 'write_file' }])
  })

  it.each([
    ['web_*', false],
    ['web_*', true],
    ['web_hook', true]
  ] as const)('preserves injected display-alias rule %s (warm %s)', (tail, warm) => {
    mocks.findServer.mockReturnValue({ id, name: 'cherry-tools' })
    mocks.listTools.mockReturnValue(warm ? [{ name: 'web_hook' }] : [])
    const rule = `mcp__cherry-tools__${tail}`
    const result = externalRules([rule, rule])
    expect.soft(result).toContain(rule)
    expect(result.filter((entry) => entry !== rule)).toEqual(warm ? [alias('web_hook')] : [])
  })

  it('keeps a registered exact Cherry rule byte-identical despite a warm display alias', () => {
    mocks.findServer.mockReturnValue({ id, name: 'cherry-tools' })
    mocks.listTools.mockReturnValue([{ name: 'web_search' }])
    const agent = { mcps: [id], disabledTools: ['mcp__cherry-tools__web_search'] }
    expect(resolveDisallowedTools(agent, undefined, true)).toEqual(resolveDisallowedTools(agent))
  })

  it.each(['web_hook', 'web_*'])('replaces authoritative canonical rule %s despite a display alias', (tail) => {
    mocks.findServer.mockReturnValue({ id, name: 'cherry-tools' })
    mocks.listTools.mockReturnValue([{ name: 'web_hook' }])
    expect(externalRules([`mcp__${id}__${tail}`])).toEqual([alias('web_hook')])
  })

  it.each(['read.file', 'read.' + 'long_name_'.repeat(12)])(
    'denies the advertised sanitized identity of %s without disabling its sibling',
    (name) => {
      mocks.listTools.mockReturnValue([{ name }, { name: 'write.file' }])
      expect(externalRules([`mcp__${id}__read_*`])).toEqual([alias(name)])
    }
  )

  it('retains the raw cross-server rule and allocates each sanitized match once', () => {
    const other = { id: 'second-server', name: 'Second Server' }
    mocks.findServer.mockImplementation((key: string) => (key === id ? server : other))
    mocks.listTools.mockReturnValue([{ name: 'read.file' }, { name: 'write.file' }])
    expect(externalRules(['mcp__*__read_*'], [id, other.id])).toEqual([
      'mcp__*__read_*',
      alias('read.file'),
      alias('read.file', other.id, other.id)
    ])
  })

  it.each(['mcp__server_*__read_*', 'mcp__mount_*__read_*'])(
    'matches sanitized server and mount segments (%s)',
    (rule) => {
      mocks.findServer.mockReturnValue({ id: 'server.id', name: 'Display' })
      mocks.listTools.mockReturnValue([{ name: 'read.file' }, { name: 'write.file' }])
      expect(externalRules([rule], ['mount.ref'])).toEqual([rule, alias('read.file', 'mount.ref', 'server.id')])
    }
  )

  it('retains the byte-identical cross-server denial without external mounts', () => {
    expect(externalRules(['mcp__*__web_*'], [])).toEqual(['mcp__*__web_*'])
  })

  it('expands cross-server suffix rules before truncating allocated names', () => {
    const name = 'read_' + 'long_name_'.repeat(12) + '_sensitive'
    mocks.listTools.mockReturnValue([{ name }, { name: 'write_file' }])
    const result = externalRules(['mcp__*__*_sensitive'])
    expect({ result, truncated: !alias(name).includes('_sensitive') }).toEqual({
      result: ['mcp__*__*_sensitive', alias(name)],
      truncated: true
    })
  })

  it('expands across mounts and deduplicates overlapping original identity forms', () => {
    const other = { id: 'second-server', name: 'Second Server' }
    const mount = 'stored-mount'
    mocks.findServer.mockImplementation((key: string) => (key === id ? server : other))
    mocks.listTools.mockReturnValue([{ name: 'read_sensitive' }])
    expect(externalRules(['mcp__*__*_sensitive', 'mcp__*__read*'], [id, mount])).toEqual([
      'mcp__*__*_sensitive',
      alias('read_sensitive'),
      alias('read_sensitive', mount, other.id),
      'mcp__*__read*'
    ])
  })

  it.each([
    ['mcp__second-*__read_*', 'read_sensitive'],
    ['mcp__stored-*__read_*', 'read_sensitive'],
    ['mcp__secondS*__readS*', 'read_sensitive'],
    ['mcp__*__read_[a].*', 'read_[a].file'],
    ['mcp__*__read_*', 'read_']
  ])('matches cross-server original forms with literal case-sensitive globs (%s)', (rule, name) => {
    const other = { id: 'second-server', name: 'Second Server' }
    mocks.findServer.mockReturnValue(other)
    mocks.listTools.mockReturnValue([
      { name },
      { name: rule === 'mcp__secondS*__readS*' ? 'write_file' : 'Read_sensitive' },
      { name: name === 'read_[a].file' ? 'read_aXfile' : 'write_file' }
    ])
    expect(externalRules([rule], ['stored-mount'])).toEqual([rule, alias(name, 'stored-mount', other.id)])
  })

  it('retains unmatched cross-server patterns while preserving unknown concrete servers', () => {
    expect(externalRules(['mcp__*__*_sensitive', 'mcp__concrete-unmounted-id__*_sensitive'])).toEqual([
      'mcp__*__*_sensitive',
      'mcp__concrete-unmounted-id__*_sensitive'
    ])
  })

  it('expands partial wildcards only to matching original tools', () => {
    const result = externalRules([`mcp__${id}__read_*`])
    expect(result).toEqual([alias('read_file')])
    expect(result).not.toContain(alias('read__'))
    expect(result).not.toContain(`mcp__${id}__*`)
    expect(result).not.toContain(alias('write_file'))
  })

  it('matches beyond the retained allocated prefix and deduplicates matching denials', () => {
    const name = 'read_abcdefghijklmnopqrstuvwxyz_deep_suffix'
    mocks.listTools.mockReturnValue([{ name }])
    const advertised = alias(name)
    expect(advertised).not.toContain('abcdefghijklmnopqrstuvwxyz')
    expect(externalRules([`mcp__${id}__read_abcdefghijklmnopqrstuvwxyz*`, `mcp__${id}__${name}`])).toEqual([advertised])
  })

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true]
  ])('resolves canonical ownership before aliases (reverse %s, mounted by name %s)', (reverse, byName) => {
    const a = { id: 'server-a', name: id }
    mocks.findServer.mockImplementation((key: string) => (key === a.id ? a : server))
    const mounts = [a.id, byName ? server.name : id]
    if (reverse) mounts.reverse()
    for (const cold of [false, true]) {
      mocks.listTools.mockReturnValue(cold ? [] : [{ name: 'run' }])
      const result = externalRules([`mcp__${id}__run`], mounts)
      expect(result).toEqual([alias('run', byName ? server.name : id)])
      expect(result).not.toContain(alias('run', a.id, a.id))
    }
  })

  it('does not fall through when the canonical owner lacks the requested tool', () => {
    const a = { id: 'server-a', name: id }
    mocks.findServer.mockImplementation((key: string) => (key === a.id ? a : server))
    mocks.listTools.mockImplementation((key: string) => (key === a.id ? [{ name: 'run' }] : []))
    expect(externalRules([`mcp__${id}__run`], [a.id, id])).toEqual([alias('run')])
  })

  it('maps legacy exact, truncated and wildcard compatibility names back to originals', () => {
    const longName = 'read_' + 'long_name_'.repeat(12)
    mocks.listTools.mockReturnValue([{ name: 'read_file' }, { name: longName }])
    expect(externalRules([buildClaudeMcpToolName(server.name, 'read_file')])).toEqual([
      buildClaudeMcpToolName(server.name, 'read_file'),
      alias('read_file')
    ])
    expect(externalRules([buildClaudeMcpToolName(server.name, longName)])).toEqual([
      buildClaudeMcpToolName(server.name, longName),
      alias(longName)
    ])
    expect(externalRules([buildClaudeMcpWildcard(server.name)])).toEqual([
      buildClaudeMcpWildcard(server.name),
      `mcp__${id}__*`
    ])
    expect(externalRules(['mcp__userMcp__read*'])).toEqual(['mcp__userMcp__read*', alias('read_file'), alias(longName)])
  })

  it('maps a legacy exact name truncated inside a long server name', () => {
    const longServerName = 'very long server name '.repeat(12)
    mocks.findServer.mockReturnValue({ id, name: longServerName })
    const rule = buildClaudeMcpToolName(longServerName, 'read_file')
    expect(rule.slice(5)).not.toContain('__')
    expect(externalRules([rule])).toEqual([rule, alias('read_file')])
  })

  it('resolves stored mount references before display aliases', () => {
    const a = { id: 'server-a', name: 'stored-mount' }
    mocks.findServer.mockImplementation((key: string) => (key === a.id ? a : server))
    expect(externalRules(['mcp__stored-mount__read_file'], [a.id, 'stored-mount'])).toEqual([
      alias('read_file', 'stored-mount')
    ])
  })

  it('keeps registered Cherry rules and dependency propagation ahead of external aliases', () => {
    mocks.findServer.mockReturnValue({ id, name: 'cherry-tools' })
    const rules = ['mcp__cherry-tools__kb_search', 'mcp__*']
    const agent = { mcps: [id], disabledTools: rules }
    expect(resolveDisallowedTools(agent, undefined, true)).toEqual(resolveDisallowedTools(agent))
    expect(agent.disabledTools).toEqual(rules)
  })

  it('preserves unknown, global and malformed rules and emits nothing for unmatched patterns', () => {
    expect(externalRules(['mcp__unknown__run', 'mcp__*', `mcp__${id}__`])).toEqual([
      'mcp__unknown__run',
      'mcp__*',
      `mcp__${id}__`
    ])
    expect(externalRules([`mcp__${id}__missing*`])).toEqual([])
    expect(externalRules([`mcp__${id}`, `mcp__${id}__*`])).toEqual([`mcp__${id}__*`])
    expect(externalRules([`mcp__${id}__a__b`])).toEqual([alias('a__b')])
  })

  it('treats glob metacharacters other than asterisks literally and matches case sensitively', () => {
    mocks.listTools.mockReturnValue([{ name: 'read_[a].file' }, { name: 'read_aXfile' }, { name: 'Read_[a].file' }])
    expect(externalRules([`mcp__${id}__read_[a].*`])).toEqual([alias('read_[a].file')])
    mocks.listTools.mockReturnValue([{ name: 'read_' }])
    expect(externalRules([`mcp__${id}__read_*`])).toEqual([alias('read_')])
  })
})
