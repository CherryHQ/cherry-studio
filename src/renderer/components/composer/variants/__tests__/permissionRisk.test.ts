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

  it('leaves read-only commands without risk effects', () => {
    expect(getPermissionRiskEffects(AgentToolsType.Bash, { command: 'pnpm test' })).toEqual([])
  })

  it('treats background output retrieval as read-only', () => {
    expect(getPermissionRiskEffects(AgentToolsType.BashOutput, { bash_id: 'bash-1', filter: 'rm -rf' })).toEqual([])
  })
})
