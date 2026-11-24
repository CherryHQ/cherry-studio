import { stripVTControlCharacters } from 'node:util'

export interface CliAuthCommandSpec {
  args: string[]
  stdin?: string
  autoOpenUrl?: boolean
}

export interface CliAuthOptions {
  secret?: string
  provider?: string
}

export interface CliAuthPrompt {
  url?: string
  code?: string
}

const VALID_PROVIDER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const URL_PATTERN = /https?:\/\/[^\s"'<>)\]]+/
const LABELED_DEVICE_CODE_PATTERN =
  /(?:verification\s+code|one-time\s+code|enter(?:\s+the)?\s+code|code)\s*[:：]\s*([A-Z0-9]{4,}(?:-[A-Z0-9]{3,})+|[A-Z0-9]{6,10})/i
const HYPHENATED_DEVICE_CODE_PATTERN = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/

/**
 * Resolves background CLI authentication invocations for local agents that support
 * direct OAuth/device/API-key flows without launching an external terminal window.
 */
export function resolveCliAuthCommand(
  presetId: string | undefined,
  methodId: string,
  options?: CliAuthOptions
): CliAuthCommandSpec | undefined {
  switch (presetId) {
    case 'claude':
      if (methodId === 'claude-subscription') return { args: ['auth', 'login', '--claudeai'] }
      if (methodId === 'claude-console') return { args: ['auth', 'login', '--console'] }
      return undefined

    case 'codex':
      if (methodId === 'codex-browser') return { args: ['login'] }
      if (methodId === 'codex-api-key') {
        const secret = options?.secret?.trim()
        if (!secret) throw new Error('API key is required')
        return { args: ['login', '--with-api-key'], stdin: `${secret}\n` }
      }
      return undefined

    case 'opencode':
      if (methodId === 'opencode-console')
        return { args: ['auth', 'login', 'opencode', '--method', 'device'], autoOpenUrl: true }
      if (methodId === 'opencode-openai')
        return { args: ['auth', 'login', 'openai', '--method', 'chatgpt-browser'], autoOpenUrl: true }
      if (methodId === 'opencode-copilot')
        return { args: ['auth', 'login', 'github-copilot', '--method', 'device'], autoOpenUrl: true }
      return undefined

    case 'kimi':
      if (methodId === 'kimi-cn') return { args: ['login', '--region', 'mainland-cn'], autoOpenUrl: true }
      if (methodId === 'kimi-global') return { args: ['login', '--region', 'global'], autoOpenUrl: true }
      return undefined

    case 'pi-acp':
      if (methodId === 'pi-browser') {
        const provider = options?.provider?.trim()
        if (!provider || !VALID_PROVIDER_PATTERN.test(provider)) throw new Error('Valid provider ID is required')
        return { args: ['auth', 'login', provider], autoOpenUrl: true }
      }
      return undefined

    default:
      return undefined
  }
}

/**
 * Extracts a sign-in verification URL and/or one-time device code from noisy CLI stdout/stderr.
 */
export function extractAuthPrompt(rawText: string): CliAuthPrompt {
  const clean = stripVTControlCharacters(rawText)
  const urlMatch = clean.match(URL_PATTERN)
  const url = urlMatch?.[0]?.replace(/[.,;]+$/, '')

  // Exclude URLs before matching device codes so UUID query params never masquerade as codes.
  const withoutUrls = clean.replace(new RegExp(URL_PATTERN.source, 'g'), ' ')
  const labeledMatch = withoutUrls.match(LABELED_DEVICE_CODE_PATTERN)
  const fallbackMatch = labeledMatch ? null : withoutUrls.match(HYPHENATED_DEVICE_CODE_PATTERN)
  const code = (labeledMatch?.[1] ?? fallbackMatch?.[1])?.toUpperCase()

  return {
    ...(url ? { url } : {}),
    ...(code ? { code } : {})
  }
}
