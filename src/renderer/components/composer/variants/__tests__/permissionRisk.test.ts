import { describe, expect, it } from 'vitest'

import { AgentToolsType } from '@renderer/components/chat/messages/tools/shared/agentToolTypes'

import { getPermissionRiskEffects } from '../permissionRisk'

describe('getPermissionRiskEffects', () => {
  it('flags recursive deletes as destructive and irreversible', () => {
    expect(getPermissionRiskEffects(AgentToolsType.Bash, { command: 'rm -rf ./dist' })).toEqual(
      expect.arrayContaining(['destructive', 'irreversible'])
    )
  })

  it('flags downloads as network operations', () => {
    expect(
      getPermissionRiskEffects(AgentToolsType.Bash, { command: 'curl https://example.com/app.zip -o app.zip' })
    ).toContain('network')
  })

  it('flags file writes as destructive and irreversible without reading command text', () => {
    expect(getPermissionRiskEffects(AgentToolsType.Write, { file_path: '/tmp/note.md' })).toEqual(
      expect.arrayContaining(['destructive', 'irreversible'])
    )
  })

  it('flags web fetching as a network operation', () => {
    expect(getPermissionRiskEffects(AgentToolsType.WebFetch, { url: 'https://example.com' })).toContain('network')
  })

  it('flags deletes hidden inside command substitution', () => {
    expect(
      getPermissionRiskEffects(AgentToolsType.Bash, { command: 'result=$(rm -rf ./dist) && echo "$result"' })
    ).toEqual(expect.arrayContaining(['destructive', 'irreversible']))
    expect(getPermissionRiskEffects(AgentToolsType.Bash, { command: 'echo `rm -rf ./dist`' })).toEqual(
      expect.arrayContaining(['destructive', 'irreversible'])
    )
  })

  it('flags disk wipes and content destruction', () => {
    expect(
      getPermissionRiskEffects(AgentToolsType.Bash, { command: 'dd if=/dev/zero of=/tmp/wipe.img bs=1M count=1' })
    ).toEqual(expect.arrayContaining(['destructive', 'irreversible']))
    expect(getPermissionRiskEffects(AgentToolsType.Bash, { command: 'truncate -s 0 data.db' })).toEqual(
      expect.arrayContaining(['destructive', 'irreversible'])
    )
    expect(getPermissionRiskEffects(AgentToolsType.Bash, { command: 'echo hi > notes.txt' })).toEqual(
      expect.arrayContaining(['destructive', 'irreversible'])
    )
  })

  it('flags moves as destructive but reversible', () => {
    expect(getPermissionRiskEffects(AgentToolsType.Bash, { command: 'mv old.txt new.txt' })).toEqual(['destructive'])
  })

  it('does not mistake arrow functions for shell redirection', () => {
    expect(getPermissionRiskEffects(AgentToolsType.Bash, { command: "node -e 'list.map((x) => x)'" })).toEqual([])
  })

  it('flags remote transfers and remote execution as network operations', () => {
    expect(getPermissionRiskEffects(AgentToolsType.Bash, { command: 'scp report.txt user@host:/tmp' })).toContain(
      'network'
    )
    expect(getPermissionRiskEffects(AgentToolsType.Bash, { command: 'ssh user@host uptime' })).toContain('network')
  })

  it('treats background output retrieval as read-only', () => {
    expect(getPermissionRiskEffects(AgentToolsType.BashOutput, { bash_id: 'bash-1', filter: 'rm -rf' })).toEqual([])
  })

  it('flags git clone as a network operation', () => {
    expect(
      getPermissionRiskEffects(AgentToolsType.Bash, { command: 'git clone git@github.com:user/repo.git' })
    ).toContain('network')
  })

  it('does not mistake descriptor duplication for file redirection', () => {
    expect(getPermissionRiskEffects(AgentToolsType.Bash, { command: 'vitest run 2>&1 | head' })).toEqual([])
  })

  it('flags path-qualified delete commands', () => {
    expect(getPermissionRiskEffects(AgentToolsType.Bash, { command: '/usr/bin/rm -rf ./dist' })).toEqual(
      expect.arrayContaining(['destructive', 'irreversible'])
    )
  })
})
