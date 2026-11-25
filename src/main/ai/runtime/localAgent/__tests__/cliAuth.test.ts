import { describe, expect, it } from 'vitest'

import { extractAuthPrompt, resolveCliAuthCommand } from '../cliAuth'

describe('resolveCliAuthCommand', () => {
  it('resolves Claude Code subscription and console browser commands', () => {
    expect(resolveCliAuthCommand('claude', 'claude-subscription')).toEqual({
      args: ['auth', 'login', '--claudeai']
    })
    expect(resolveCliAuthCommand('claude', 'claude-console')).toEqual({
      args: ['auth', 'login', '--console']
    })
  })

  it('resolves Codex browser OAuth and stdin API key login commands', () => {
    expect(resolveCliAuthCommand('codex', 'codex-browser')).toEqual({
      args: ['login']
    })
    expect(resolveCliAuthCommand('codex', 'codex-api-key', { secret: '  sk-test-123  ' })).toEqual({
      args: ['login', '--with-api-key'],
      stdin: 'sk-test-123\n'
    })
    expect(() => resolveCliAuthCommand('codex', 'codex-api-key', { secret: '   ' })).toThrow('API key is required')
  })

  it('resolves OpenCode Console, OpenAI, and GitHub Copilot direct flows', () => {
    expect(resolveCliAuthCommand('opencode', 'opencode-console')).toEqual({
      args: ['auth', 'login', 'opencode', '--method', 'device'],
      autoOpenUrl: true
    })
    expect(resolveCliAuthCommand('opencode', 'opencode-openai')).toEqual({
      args: ['auth', 'login', 'openai', '--method', 'chatgpt-browser'],
      autoOpenUrl: true
    })
    expect(resolveCliAuthCommand('opencode', 'opencode-copilot')).toEqual({
      args: ['auth', 'login', 'github-copilot', '--method', 'device'],
      autoOpenUrl: true
    })
  })

  it('resolves Kimi region flows and Pi provider browser flow', () => {
    expect(resolveCliAuthCommand('kimi', 'kimi-cn')).toEqual({
      args: ['login', '--region', 'mainland-cn'],
      autoOpenUrl: true
    })
    expect(resolveCliAuthCommand('kimi', 'kimi-global')).toEqual({
      args: ['login', '--region', 'global'],
      autoOpenUrl: true
    })
    expect(resolveCliAuthCommand('pi-acp', 'pi-browser', { provider: ' openai-codex ' })).toEqual({
      args: ['auth', 'login', 'openai-codex'],
      autoOpenUrl: true
    })
    expect(() => resolveCliAuthCommand('pi-acp', 'pi-browser', { provider: 'bad provider!' })).toThrow(
      'Valid provider ID is required'
    )
  })

  it('returns undefined for ACP native methods or unknown presets', () => {
    expect(resolveCliAuthCommand('antigravity-acp', 'oauth-personal')).toBeUndefined()
    expect(resolveCliAuthCommand('claude', 'unknown-method')).toBeUndefined()
  })
})

describe('extractAuthPrompt', () => {
  it('extracts ANSI-colored device URL and one-time verification code from OpenCode/Copilot output', () => {
    const raw =
      '\u001b[32m◇\u001b[0m  Authorization started\n' +
      '●  Enter code: \u001b[1mGZNF-ZXWC\u001b[0m\n' +
      '●  \u001b[4mhttps://opencode.ai/console/device?user_code=GZNF-ZXWC&client_id=opencode-cli\u001b[0m\n'

    expect(extractAuthPrompt(raw)).toEqual({
      url: 'https://opencode.ai/console/device?user_code=GZNF-ZXWC&client_id=opencode-cli',
      code: 'GZNF-ZXWC'
    })
  })

  it('extracts device URL and code from Kimi output without misparsing query params', () => {
    const raw =
      'Opening browser for Kimi device login: https://www.kimi.com/code/authorize_device?user_code=WS9Y-NZXG\n' +
      'If the browser did not open, paste the URL above and enter code: WS9Y-NZXG\n' +
      'Code expires in 1800s.\n'

    expect(extractAuthPrompt(raw)).toEqual({
      url: 'https://www.kimi.com/code/authorize_device?user_code=WS9Y-NZXG',
      code: 'WS9Y-NZXG'
    })
  })

  it('extracts OAuth URL without hallucinating a device code from URL query UUIDs', () => {
    const raw =
      "Browser didn't open? Use the url below to sign in:\n" +
      'https://claude.ai/oauth/authorize?code=true&state=a1b2c3d4-E5F6-4A7B-8C9D-e0f1a2b3c4d5.\n'

    expect(extractAuthPrompt(raw)).toEqual({
      url: 'https://claude.ai/oauth/authorize?code=true&state=a1b2c3d4-E5F6-4A7B-8C9D-e0f1a2b3c4d5'
    })
  })

  it('extracts standalone 4-4 device codes when preceded by a URL or prose', () => {
    const raw = 'Visit https://github.com/login/device and submit AB12-CD34 within 15 minutes.'
    expect(extractAuthPrompt(raw)).toEqual({
      url: 'https://github.com/login/device',
      code: 'AB12-CD34'
    })
  })
})
