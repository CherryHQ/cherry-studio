import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildSystemSkillSources } from '../systemSkillSources'

describe('buildSystemSkillSources', () => {
  it('uses system defaults for supported CLI skill roots', () => {
    const home = path.resolve('/home/test')
    const byId = new Map(buildSystemSkillSources(home, {}).map((source) => [source.id, source.directoryPath]))

    expect(byId.get('agents')).toBe(path.join(home, '.agents', 'skills'))
    expect(byId.get('agents-xdg')).toBe(path.join(home, '.config', 'agents', 'skills'))
    expect(byId.get('claude-code')).toBe(path.join(home, '.claude', 'skills'))
    expect(byId.get('codex')).toBe(path.join(home, '.codex', 'skills'))
    expect(byId.get('opencode')).toBe(path.join(home, '.config', 'opencode', 'skills'))
  })

  it('respects CLI and XDG home overrides', () => {
    const home = path.resolve('/home/test')
    const byId = new Map(
      buildSystemSkillSources(home, {
        CLAUDE_CONFIG_DIR: '/configs/claude',
        CODEX_HOME: '/configs/codex',
        XDG_CONFIG_HOME: '/configs/xdg'
      }).map((source) => [source.id, source.directoryPath])
    )

    expect(byId.get('claude-code')).toBe(path.join('/configs/claude', 'skills'))
    expect(byId.get('codex')).toBe(path.join('/configs/codex', 'skills'))
    expect(byId.get('opencode')).toBe(path.join('/configs/xdg', 'opencode', 'skills'))
    expect(byId.get('agents-xdg')).toBe(path.join('/configs/xdg', 'agents', 'skills'))
  })
})
