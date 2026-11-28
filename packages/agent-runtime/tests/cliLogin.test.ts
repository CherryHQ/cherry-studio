import { describe, expect, it } from 'vitest'

import { extractAuthPrompt } from '../src/cliLogin'

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
