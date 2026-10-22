import { createHash } from 'node:crypto'

import type { ClaudeCodeSpawnFacts } from './processExitDiagnostics'

const VERSION = 'claude-spawn-v1'
// SDK ProcessTransport flags; arity prevents flag-shaped operands becoming invocation structure.
const FLAG_ARITY: Readonly<Record<string, number>> = Object.freeze({
  '--output-format': 1,
  '--verbose': 0,
  '--input-format': 1,
  '--thinking': 1,
  '--thinking-display': 1,
  '--max-thinking-tokens': 1,
  '--effort': 1,
  '--max-turns': 1,
  '--max-budget-usd': 1,
  '--task-budget': 1,
  '--model': 1,
  '--agent': 1,
  '--betas': 1,
  '--json-schema': 1,
  '--debug-file': 1,
  '--debug': 0,
  '--permission-prompt-tool': 1,
  '--permission-prompts': 1,
  '--continue': 0,
  '--resume': 1,
  '--channels': 1,
  '--allowedTools': 1,
  '--disallowedTools': 1,
  '--tools': 1,
  '--mcp-config': 1,
  '--setting-sources': 1,
  '--strict-mcp-config': 0,
  '--permission-mode': 1,
  '--allow-dangerously-skip-permissions': 0,
  '--fallback-model': 1,
  '--include-hook-events': 0,
  '--include-partial-messages': 0,
  '--session-mirror': 0,
  '--project-config-root': 1,
  '--add-dir': 1,
  '--await-initialize': 0,
  '--plugin-dir': 1,
  '--plugin-dir-no-mcp': 1,
  '--fork-session': 0,
  '--resume-session-at': 1,
  '--resume-drops-turn': 1,
  '--session-id': 1,
  '--no-session-persistence': 0,
  '--managed-settings': 1,
  '--settings': 1
})

export function getClaudeCodeSpawnFacts(command: string, args: readonly string[]): ClaudeCodeSpawnFacts {
  const basename = command
    .split(/[\\/]/)
    .at(-1)
    ?.toLowerCase()
    .replace(/\.exe$/, '')
  const family = basename === 'claude' || basename === 'node' || basename === 'bun' ? basename : 'custom'
  const skeleton: string[] = []
  let positional = false
  let resumeToken: string | null = null
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (positional) {
      skeleton.push('[positional]')
      continue
    }
    if (arg === '--') {
      skeleton.push('--')
      positional = true
      continue
    }
    const equals = arg.indexOf('=')
    const name = equals < 0 ? arg : arg.slice(0, equals)
    const arity = Object.hasOwn(FLAG_ARITY, name) ? FLAG_ARITY[name] : undefined
    if (arity === undefined) {
      skeleton.push(arg.startsWith('-') ? (equals < 0 ? '[option]' : '[option]=[value]') : '[positional]')
      continue
    }
    skeleton.push(equals < 0 ? name : `${name}=[value]`)
    if (arity === 1) {
      const operand = equals < 0 ? args[++index] : arg.slice(equals + 1)
      if (equals < 0) skeleton.push(operand === undefined ? '[missing]' : '[value]')
      if (name === '--resume') resumeToken = operand ?? null
    }
  }
  const digest = createHash('sha256')
    .update(JSON.stringify([VERSION, family, skeleton]))
    .digest('hex')
  return { resumeToken, spawnArgsFingerprint: `${VERSION}:${digest}` }
}
