import { describe, expect, it } from 'vitest'

import { resolveCliAuthCommand } from '../cliAuth'

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

  it('uses native ZCode OAuth and MiniMax login commands', () => {
    expect(resolveCliAuthCommand('zcode', 'zcode-browser')).toEqual({
      args: ['login', '--no-browser'],
      autoOpenUrl: true
    })
    expect(resolveCliAuthCommand('minimax', 'minimax-browser')).toEqual({ args: ['login'] })
  })
})
