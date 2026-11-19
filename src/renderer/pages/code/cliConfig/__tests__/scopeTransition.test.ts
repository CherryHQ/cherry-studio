import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import { CodeCli } from '@shared/types/codeCli'
import { CLI_CONFIG_FILE_SPECS, type CliConfigTarget } from '@shared/utils/cliConfig'

import { getAdapter } from '../adapters'
import { clearCliConfig } from '../clear'
import { readOwnLoginCliConfigDraft, writeCliConfigDraft, writeOwnLoginCliConfigDraft } from '../draft'
import { disableClaudeScopedSettings, enableClaudeScopedSettings } from '../scopeTransition'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))
const globalContent = JSON.stringify({
  user: 'keep',
  permissions: { allow: ['Bash(ls)'], defaultMode: 'plan' },
  env: { ANTHROPIC_AUTH_TOKEN: 'old', USER: 'keep' }
})
const selection = { kind: 'provider' as const, modelId: 'p::model' as const }

beforeEach(() => {
  mocks.request.mockReset()
  mocks.request.mockImplementation(async (route: string, input: any) =>
    route === 'code_cli.read_config'
      ? {
          files: input.targets.map((target: CliConfigTarget) => ({
            target,
            path: CLI_CONFIG_FILE_SPECS[target].path,
            content: target === 'claude-settings' ? globalContent : null
          }))
        }
      : { success: true }
  )
  vi.mocked(dataApiService.get).mockImplementation(async (path: string) => {
    if (path.endsWith('/api-keys')) return { keys: [{ key: 'secret', isEnabled: true }] } as any
    if (path.startsWith('/providers/'))
      return {
        id: 'p',
        name: 'P',
        endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://example.com' } }
      } as any
    return null as any
  })
})
function payload() {
  return mocks.request.mock.calls.find(([route]) => route === 'code_cli.write_config')?.[1]
}

describe('Claude scope routing', () => {
  it('enables with a clean provider overlay and scrubbed global settings', async () => {
    await enableClaudeScopedSettings({ selection, currentProviderId: 'persisted-provider' })
    const result = payload()
    expect(result.claudeScopedSettings).toBe(true)
    expect(result.expectedClaudeProviderId).toBe('persisted-provider')
    expect(result.files.map((f: any) => f.target)).toEqual(['claude-settings', 'claude-scoped-settings'])
    expect(JSON.parse(result.files[0].content)).toEqual({
      user: 'keep',
      permissions: { allow: ['Bash(ls)'] },
      env: { USER: 'keep' }
    })
    const overlay = JSON.parse(result.files[1].content)
    expect(overlay.user).toBeUndefined()
    expect(overlay.permissions?.allow).toBeUndefined()
    expect(overlay.env.ANTHROPIC_AUTH_TOKEN).toBe('secret')
  })
  it.each([false, true])('writes the selected destination when scope is %s', async (scoped) => {
    await writeCliConfigDraft({ cliTool: CodeCli.CLAUDE_CODE, modelId: 'p::model', claudeScopedSettings: scoped })
    const file = payload().files[0]
    expect(file.target).toBe(scoped ? 'claude-scoped-settings' : 'claude-settings')
    expect(JSON.parse(file.content).user).toBe(scoped ? undefined : 'keep')
  })
  it.each([false, true])('moves own-login settings with scope %s and strips credentials', async (scoped) => {
    const ctx = {
      claudeScopedSettings: !scoped,
      currentProviderId: null,
      selection: { kind: 'own-login' as const, configBlob: { effortLevel: 'high' } }
    }
    if (scoped) await enableClaudeScopedSettings(ctx)
    else await disableClaudeScopedSettings(ctx)
    const file = payload().files.find(
      (entry: any) => entry.target === (scoped ? 'claude-scoped-settings' : 'claude-settings')
    )
    const content = JSON.parse(file.content)
    expect(content.effortLevel).toBe('high')
    expect(content.env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    if (!scoped) expect(content.user).toBe('keep')
  })
  it('leaves an existing empty global file untouched when enabling', async () => {
    mocks.request.mockImplementation(async (route: string, input: any) =>
      route === 'code_cli.read_config'
        ? {
            files: input.targets.map((target: CliConfigTarget) => ({
              target,
              path: CLI_CONFIG_FILE_SPECS[target].path,
              content: ''
            }))
          }
        : { success: true }
    )
    await enableClaudeScopedSettings({ currentProviderId: null })
    expect(payload().files).toEqual([{ target: 'claude-scoped-settings', content: '{}\n' }])
  })
  it('preserves deliberate credentials in a raw own-login draft', async () => {
    const draft = await readOwnLoginCliConfigDraft({ cliTool: CodeCli.CLAUDE_CODE, claudeScopedSettings: true })
    const content = '{"env":{"ANTHROPIC_API_KEY":"manual","ANTHROPIC_BASE_URL":"https://manual"}}'
    await writeOwnLoginCliConfigDraft({
      cliTool: CodeCli.CLAUDE_CODE,
      claudeScopedSettings: true,
      files: [{ ...draft[0], content }]
    })
    expect(payload().files[0].content).toBe(content)
  })
  it('enables without a selection with an empty overlay', async () => {
    await enableClaudeScopedSettings({ currentProviderId: null })
    expect(payload().files.map((f: any) => f.target)).toEqual(['claude-settings', 'claude-scoped-settings'])
    expect(JSON.parse(payload().files[1].content)).toEqual({})
  })
  it('disables with a provider while preserving global user settings', async () => {
    await disableClaudeScopedSettings({ claudeScopedSettings: true, currentProviderId: null, selection })
    const result = payload()
    expect(result.claudeScopedSettings).toBe(false)
    expect(result.files[1]).toEqual({ target: 'claude-scoped-settings', delete: true })
    expect(JSON.parse(result.files[0].content)).toMatchObject({
      user: 'keep',
      permissions: { allow: ['Bash(ls)'] },
      env: { USER: 'keep', ANTHROPIC_AUTH_TOKEN: 'secret' }
    })
  })
  it.each(['provider', 'own-login'] as const)('preserves scoped user edits when disabling %s', async (kind) => {
    mocks.request.mockImplementation(async (route: string, input: any) =>
      route === 'code_cli.read_config'
        ? {
            files: input.targets.map((target: CliConfigTarget) => ({
              target,
              path: CLI_CONFIG_FILE_SPECS[target].path,
              content:
                target === 'claude-scoped-settings'
                  ? JSON.stringify({ env: { EXTRA: 'keep' }, permissions: { allow: ['Bash(pwd)'] } })
                  : globalContent
            }))
          }
        : { success: true }
    )
    await disableClaudeScopedSettings({
      claudeScopedSettings: true,
      currentProviderId: null,
      selection: kind === 'provider' ? selection : { kind, configBlob: { effortLevel: 'high' } }
    })
    const result = payload()
    expect(JSON.parse(result.files[0].content)).toMatchObject({
      env: {
        EXTRA: 'keep',
        ...(kind === 'provider' ? { ANTHROPIC_AUTH_TOKEN: 'secret', ANTHROPIC_BASE_URL: 'https://example.com' } : {})
      },
      permissions: { allow: ['Bash(pwd)'] }
    })
    expect(result.files[1]).toEqual({ target: 'claude-scoped-settings', delete: true })
  })
  it.each(['{ broken', '', '  '])('refuses to delete malformed scoped settings (%s)', async (content) => {
    mocks.request.mockImplementation(async (route: string, input: any) =>
      route === 'code_cli.read_config'
        ? {
            files: input.targets.map((target: CliConfigTarget) => ({ target, path: '/scoped/settings.json', content }))
          }
        : { success: true }
    )
    await expect(
      disableClaudeScopedSettings({ claudeScopedSettings: true, currentProviderId: null, selection })
    ).rejects.toThrow(/settings.*\/scoped\/settings.json/i)
    expect(payload()).toBeUndefined()
  })
  it('refuses to delete malformed scoped settings without a selection', async () => {
    mocks.request.mockImplementation(async (_route: string, input: any) => ({
      files: input.targets.map((target: CliConfigTarget) => ({ target, path: '/scoped/settings.json', content: '{' }))
    }))
    await expect(disableClaudeScopedSettings({ claudeScopedSettings: true, currentProviderId: null })).rejects.toThrow(
      /settings.*\/scoped\/settings.json/i
    )
    expect(payload()).toBeUndefined()
  })
  it('disables without a selection and is idempotent', async () => {
    await disableClaudeScopedSettings({ claudeScopedSettings: true, currentProviderId: null })
    expect(payload()).toEqual({
      cliTool: CodeCli.CLAUDE_CODE,
      files: [{ target: 'claude-scoped-settings', delete: true }],
      claudeScopedSettings: false,
      expectedClaudeProviderId: null
    })
    mocks.request.mockClear()
    await disableClaudeScopedSettings({ currentProviderId: null })
    await enableClaudeScopedSettings({ claudeScopedSettings: true, currentProviderId: null })
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('rejects stale drafts and clears only the active target', async () => {
    const draft = await readOwnLoginCliConfigDraft({ cliTool: CodeCli.CLAUDE_CODE })
    await expect(
      writeCliConfigDraft({ cliTool: CodeCli.CLAUDE_CODE, claudeScopedSettings: true, files: draft })
    ).rejects.toThrow(/reload.*retry/i)
    await clearCliConfig({ cliTool: CodeCli.CLAUDE_CODE, claudeScopedSettings: true })
    expect(payload()).toBeUndefined()
    await clearCliConfig({ cliTool: CodeCli.CLAUDE_CODE })
    expect(payload().files.map((f: any) => f.target)).toEqual(['claude-settings'])
  })
  it('writes own-login parameters to the active destination without credentials', async () => {
    await writeOwnLoginCliConfigDraft({
      cliTool: CodeCli.CLAUDE_CODE,
      claudeScopedSettings: true,
      configBlob: { effortLevel: 'high' }
    })
    const file = payload().files[0]
    expect(file.target).toBe('claude-scoped-settings')
    expect(JSON.parse(file.content)).toMatchObject({ effortLevel: 'high' })
    expect(file.content).not.toContain('old')
  })
  it('extracts and updates the actual scoped draft', async () => {
    const files = await readOwnLoginCliConfigDraft({
      cliTool: CodeCli.CLAUDE_CODE,
      claudeScopedSettings: true,
      configBlob: { effortLevel: 'high' }
    })
    const adapter = getAdapter(CodeCli.CLAUDE_CODE)!
    expect(adapter.extractConfig(files)).toMatchObject({ effortLevel: 'high' })
    const updated = adapter.updateDraftConfig(files, { apiKey: 'new', baseUrl: 'https://example.com', model: 'm' }, {})
    expect(updated[0].target).toBe('claude-scoped-settings')
    expect(adapter.extractConnection(updated)).toMatchObject({ apiKey: 'new', model: 'm' })
  })
})
