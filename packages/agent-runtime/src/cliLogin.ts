import { stripVTControlCharacters } from 'node:util'

import type { LaunchSpec, SpawnStdio } from './stdio'

interface CliAuthPrompt {
  url?: string
  code?: string
}

const URL_PATTERN = /https?:\/\/[^\s"'<>)\]]+/
const LABELED_DEVICE_CODE_PATTERN =
  /(?:verification\s+code|one-time\s+code|enter(?:\s+the)?\s+code|code)\s*[:：]\s*([A-Z0-9]{4,}(?:-[A-Z0-9]{3,})+|[A-Z0-9]{6,10})/i
const HYPHENATED_DEVICE_CODE_PATTERN = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/

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

export async function runCliLogin(
  launch: LaunchSpec,
  spawn: SpawnStdio,
  signal: AbortSignal,
  stdin: string | undefined,
  onPrompt: (prompt: CliAuthPrompt) => void
): Promise<void> {
  signal.throwIfAborted()
  const child = spawn(launch)
  let recentOutput = ''
  let inputError: Error | undefined
  child.stdin.once('error', (error: Error) => {
    inputError = error
  })
  let previous: CliAuthPrompt = {}
  const onOutput = (chunk: string) => {
    if (signal.aborted) return
    recentOutput = (recentOutput + chunk).slice(-4000)
    const next = extractAuthPrompt(recentOutput)
    const prompt = { url: next.url ?? previous.url, code: next.code ?? previous.code }
    if (prompt.url !== previous.url || prompt.code !== previous.code) {
      previous = prompt
      onPrompt(prompt)
    }
  }
  child.stdout.setEncoding('utf8').on('data', onOutput)
  child.stderr.setEncoding('utf8').on('data', onOutput)

  let cancel: (() => void) | undefined
  let stopping: Promise<void> | undefined
  try {
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => {
        stopping = child.closeAndJoin()
        void stopping.then(() => reject(signal.reason), reject)
      }
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) cancel()
    })
    if (!signal.aborted) child.stdin.end(stdin)
    const result = await Promise.race([child.closed, cancelled])
    signal.throwIfAborted()
    if (result.kind === 'spawn-failed') throw result.error
    if (result.code === 0) return
    const tail = stripVTControlCharacters(recentOutput).trim().split(/\r?\n/).filter(Boolean).slice(-4).join(' ')
    throw new Error(
      tail || inputError?.message || `Authentication failed with exit code ${result.code ?? result.signal ?? 'unknown'}`
    )
  } finally {
    if (cancel) signal.removeEventListener('abort', cancel)
    child.stdout.off('data', onOutput)
    child.stderr.off('data', onOutput)
    await stopping
  }
}
