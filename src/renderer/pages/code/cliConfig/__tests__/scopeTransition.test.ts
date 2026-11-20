import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import { preferenceService } from '@data/PreferenceService'
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
    const writes = mocks.request.mock.calls.filter(([route]) => route === 'code_cli.write_config')
    expect(writes).toHaveLength(1)
    const result = writes[0][1]
    expect(result.claudeScopedSettings).toBe(true)
    expect(result.expectedClaudeProviderId).toBe('persisted-provider')
    expect(result.files.map((f: any) => f.target)).toEqual(['claude-scoped-settings', 'claude-settings'])
    expect(JSON.parse(result.files[1].content)).toEqual({
      user: 'keep',
      permissions: { allow: ['Bash(ls)'] },
      env: { USER: 'keep' }
    })
    const overlay = JSON.parse(result.files[0].content)
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
  it.each([null, '', ' \t\r\n'])(
    'leaves an existing empty global file untouched when enabling (%s)',
    async (content) => {
      mocks.request.mockImplementation(async (route: string, input: any) =>
        route === 'code_cli.read_config'
          ? {
              files: input.targets.map((target: CliConfigTarget) => ({
                target,
                path: CLI_CONFIG_FILE_SPECS[target].path,
                content: target === 'claude-settings' ? '' : content
              }))
            }
          : { success: true }
      )
      await enableClaudeScopedSettings({ currentProviderId: null })
      expect(payload().files).toEqual([{ target: 'claude-scoped-settings', content: '{}\n' }])
    }
  )
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
    expect(payload().files).toEqual([{ target: 'claude-scoped-settings', content: '{}\n' }])
  })
  it('enables without a selection without touching personal global credentials or permissions', async () => {
    const global = JSON.stringify({ env: { ANTHROPIC_API_KEY: 'personal' }, permissions: { defaultMode: 'plan' } })
    mocks.request.mockImplementation(async (route: string, input: any) =>
      route === 'code_cli.read_config'
        ? {
            files: input.targets.map((target: CliConfigTarget) => ({
              target,
              path: CLI_CONFIG_FILE_SPECS[target].path,
              content: target === 'claude-settings' ? global : null
            }))
          }
        : { success: true }
    )
    await enableClaudeScopedSettings({ currentProviderId: null })
    const writes = mocks.request.mock.calls.filter(([route]) => route === 'code_cli.write_config')
    expect(writes.map(([, input]) => input)).toEqual([
      {
        cliTool: CodeCli.CLAUDE_CODE,
        files: [{ target: 'claude-scoped-settings', content: '{}\n' }],
        claudeScopedSettings: true,
        expectedClaudeProviderId: null
      }
    ])
  })
  it('commits the mode only after both files are written', async () => {
    await preferenceService.set('feature.code_cli.configs', {
      [CodeCli.CLAUDE_CODE]: { providers: {}, current: null, claudeScopedSettings: false }
    })
    vi.mocked(preferenceService.get).mockClear()
    vi.mocked(preferenceService.set).mockClear()
    const request = mocks.request.getMockImplementation()!
    mocks.request.mockImplementation(async (route: string, input: any) => {
      if (route === 'code_cli.write_config') throw new Error('batch write failed')
      return request(route, input)
    })
    await expect(enableClaudeScopedSettings({ selection, currentProviderId: null })).rejects.toThrow(
      'batch write failed'
    )
    const writes = mocks.request.mock.calls.filter(([route]) => route === 'code_cli.write_config')
    expect(writes).toHaveLength(1)
    expect(writes[0][1].files.map((file: any) => file.target)).toEqual(['claude-scoped-settings', 'claude-settings'])
    expect(writes[0][1].claudeScopedSettings).toBe(true)
    expect(JSON.parse(writes[0][1].files[0].content).env.ANTHROPIC_AUTH_TOKEN).toBe('secret')
    expect(preferenceService.set).not.toHaveBeenCalled()
    expect(preferenceService.get).not.toHaveBeenCalled()
    const configs = await preferenceService.get('feature.code_cli.configs')
    expect(configs[CodeCli.CLAUDE_CODE]?.claudeScopedSettings).toBe(false)
    expect(preferenceService.get).toHaveBeenCalledTimes(1)
  })
  it('writes the overlay before scrubbing the global file in one request', async () => {
    await enableClaudeScopedSettings({ selection, currentProviderId: 'persisted-provider' })
    const writes = mocks.request.mock.calls.filter(([route]) => route === 'code_cli.write_config')
    expect(writes).toHaveLength(1)
    expect(writes[0][1].files.map((file: any) => file.target)).toEqual(['claude-scoped-settings', 'claude-settings'])
    expect(JSON.parse(writes[0][1].files[0].content)).toEqual({
      env: { ANTHROPIC_AUTH_TOKEN: 'secret', ANTHROPIC_BASE_URL: 'https://example.com', ANTHROPIC_MODEL: 'model' }
    })
    expect(JSON.parse(writes[0][1].files[1].content)).toEqual({
      user: 'keep',
      permissions: { allow: ['Bash(ls)'] },
      env: { USER: 'keep' }
    })
    expect(writes[0][1].claudeScopedSettings).toBe(true)
    expect(writes[0][1].expectedClaudeProviderId).toBe('persisted-provider')
  })
  it('refuses to enable a selection when global settings contain invalid JSON', async () => {
    mocks.request.mockImplementation(async (route: string, input: any) =>
      route === 'code_cli.read_config'
        ? {
            files: input.targets.map((target: CliConfigTarget) => ({
              target,
              path: '/global/settings.json',
              content: '{ broken'
            }))
          }
        : { success: true }
    )
    await expect(enableClaudeScopedSettings({ selection, currentProviderId: null })).rejects.toThrow(
      /settings.*\/global\/settings.json.*invalid JSONC/i
    )
    expect(mocks.request.mock.calls.filter(([route]) => route === 'code_cli.write_config')).toEqual([])
  })
  it('enables without a selection by preserving the existing overlay text verbatim', async () => {
    const content = '{\n  // user settings\n  "env": { "EXTRA": "keep" }\n}\n'
    const request = mocks.request.getMockImplementation()!
    mocks.request.mockImplementation(async (route: string, input: any) => {
      const result = await request(route, input)
      if (route === 'code_cli.read_config') {
        for (const file of result.files) {
          if (file.target === 'claude-scoped-settings') file.content = content
        }
      }
      return result
    })
    await enableClaudeScopedSettings({ currentProviderId: null })
    expect(payload().files).toEqual([{ target: 'claude-scoped-settings', content }])
  })
  it('disables with a provider while preserving global user settings', async () => {
    await disableClaudeScopedSettings({ claudeScopedSettings: true, currentProviderId: null, selection })
    const result = payload()
    expect(result.claudeScopedSettings).toBe(false)
    expect(mocks.request.mock.calls.filter(([route]) => route === 'code_cli.write_config')).toHaveLength(1)
    expect(result.files.map((file: any) => file.target)).toEqual(['claude-scoped-settings', 'claude-settings'])
    expect(result.files[0]).toEqual({ target: 'claude-scoped-settings', delete: true })
    expect(JSON.parse(result.files[1].content)).toMatchObject({
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
                  : JSON.stringify({
                      user: 'keep',
                      language: 'en',
                      permissions: { allow: ['Bash(ls)'], deny: ['Read(.env)'], defaultMode: 'plan' },
                      env: { ANTHROPIC_AUTH_TOKEN: 'old', USER: 'keep', EXTRA: 'global' }
                    })
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
    expect(JSON.parse(result.files[1].content)).toEqual({
      user: 'keep',
      language: 'en',
      env: {
        USER: 'keep',
        EXTRA: 'keep',
        ...(kind === 'provider'
          ? { ANTHROPIC_AUTH_TOKEN: 'secret', ANTHROPIC_BASE_URL: 'https://example.com', ANTHROPIC_MODEL: 'model' }
          : {})
      },
      permissions: { allow: ['Bash(ls)', 'Bash(pwd)'], deny: ['Read(.env)'] },
      ...(kind === 'own-login' ? { effortLevel: 'high' } : {})
    })
    expect(result.files[0]).toEqual({ target: 'claude-scoped-settings', delete: true })
  })
  it('merges permission lists when both files define them', async () => {
    mocks.request.mockImplementation(async (route: string, input: any) =>
      route === 'code_cli.read_config'
        ? {
            files: input.targets.map((target: CliConfigTarget) => ({
              target,
              path: CLI_CONFIG_FILE_SPECS[target].path,
              content: JSON.stringify({
                permissions:
                  target === 'claude-scoped-settings'
                    ? {
                        allow: ['Bash(pwd)', 'Bash(ls)', 'Bash(pwd)'],
                        deny: ['Read(.aws)'],
                        ask: ['Write(*)', 'Edit(*)'],
                        defaultMode: 'acceptEdits'
                      }
                    : {
                        allow: ['Bash(ls)'],
                        deny: ['Read(.env)'],
                        ask: ['Edit(*)'],
                        defaultMode: 'plan'
                      }
              })
            }))
          }
        : { success: true }
    )
    await disableClaudeScopedSettings({ claudeScopedSettings: true, currentProviderId: null })
    const global = payload().files.find((file: any) => file.target === 'claude-settings')
    expect(JSON.parse(global.content).permissions).toEqual({
      allow: ['Bash(ls)', 'Bash(pwd)'],
      deny: ['Read(.env)', 'Read(.aws)'],
      ask: ['Edit(*)', 'Write(*)'],
      defaultMode: 'acceptEdits'
    })
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
  it('merges scoped user edits into global settings when disabling without a selection', async () => {
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
    await disableClaudeScopedSettings({ claudeScopedSettings: true, currentProviderId: null })
    const writes = mocks.request.mock.calls.filter(([route]) => route === 'code_cli.write_config')
    expect(writes).toHaveLength(1)
    const result = writes[0][1]
    expect(result.files).toHaveLength(2)
    expect(result.files[1].target).toBe('claude-settings')
    expect(JSON.parse(result.files[1].content)).toEqual({
      user: 'keep',
      permissions: { allow: ['Bash(ls)', 'Bash(pwd)'], defaultMode: 'plan' },
      env: { ANTHROPIC_AUTH_TOKEN: 'old', USER: 'keep', EXTRA: 'keep' }
    })
    expect(result.files[0]).toEqual({ target: 'claude-scoped-settings', delete: true })
    expect(result.claudeScopedSettings).toBe(false)
  })
  it.each([null, ''])(
    'uses an empty base when disabling with missing or empty global settings (%s)',
    async (content) => {
      mocks.request.mockImplementation(async (route: string, input: any) =>
        route === 'code_cli.read_config'
          ? {
              files: input.targets.map((target: CliConfigTarget) => ({
                target,
                path: CLI_CONFIG_FILE_SPECS[target].path,
                content: target === 'claude-settings' ? content : '{"env":{"EXTRA":"keep"}}'
              }))
            }
          : { success: true }
      )
      await disableClaudeScopedSettings({ claudeScopedSettings: true, currentProviderId: null })
      expect(payload().files).toEqual([
        { target: 'claude-scoped-settings', delete: true },
        { target: 'claude-settings', content: '{\n  "env": {\n    "EXTRA": "keep"\n  }\n}\n' }
      ])
    }
  )
  it('refuses to disable when global settings contain invalid JSON', async () => {
    mocks.request.mockImplementation(async (route: string, input: any) =>
      route === 'code_cli.read_config'
        ? {
            files: input.targets.map((target: CliConfigTarget) => ({
              target,
              path: target === 'claude-settings' ? '/global/settings.json' : '/scoped/settings.json',
              content: target === 'claude-settings' ? '{ broken' : '{"env":{"EXTRA":"keep"}}'
            }))
          }
        : { success: true }
    )
    await expect(disableClaudeScopedSettings({ claudeScopedSettings: true, currentProviderId: null })).rejects.toThrow(
      /settings.*\/global\/settings.json.*invalid JSONC/i
    )
    expect(mocks.request.mock.calls.filter(([route]) => route === 'code_cli.write_config')).toEqual([])
  })
  it('disables without a selection and is idempotent', async () => {
    await disableClaudeScopedSettings({ claudeScopedSettings: true, currentProviderId: null })
    expect(payload()).toEqual({
      cliTool: CodeCli.CLAUDE_CODE,
      files: [
        { target: 'claude-scoped-settings', delete: true },
        { target: 'claude-settings', content: expect.any(String) }
      ],
      claudeScopedSettings: false,
      expectedClaudeProviderId: null
    })
    expect(JSON.parse(payload().files[1].content)).toEqual({
      user: 'keep',
      permissions: { allow: ['Bash(ls)'], defaultMode: 'plan' },
      env: { ANTHROPIC_AUTH_TOKEN: 'old', USER: 'keep' }
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
