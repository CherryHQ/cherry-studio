import { readFile } from 'node:fs/promises'
import { parentPort, workerData } from 'node:worker_threads'

interface ValidationInput {
  configDir: string
  targetCwd: string
  sessionId: string
  file: string
  expectation: { messageCount: number; boundaries: Array<{ uuid: string; index: number }> }
}

async function run(input: ValidationInput): Promise<void> {
  const lines = (await readFile(input.file, 'utf8')).split('\n').filter((line) => line.trim())
  if (!lines.length) throw new Error('history_corrupt')
  let records: Array<Record<string, unknown>>
  try {
    records = lines.map((line) => {
      const value: unknown = JSON.parse(line)
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid record')
      return value as Record<string, unknown>
    })
  } catch {
    throw new Error('history_corrupt')
  }
  process.env.CLAUDE_CONFIG_DIR = input.configDir
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  let messages: Awaited<ReturnType<typeof sdk.getSessionMessages>>
  try {
    messages = await sdk.getSessionMessages(input.sessionId, { dir: input.targetCwd, includeSystemMessages: true })
  } catch {
    throw new Error('unsupported_checkpoint')
  }
  if (!messages.length || messages.length !== input.expectation.messageCount) throw new Error('unsupported_checkpoint')
  for (const boundary of input.expectation.boundaries) {
    const message = messages[boundary.index]
    const record = records.find((entry) => entry.uuid === boundary.uuid)
    if (
      message?.uuid !== boundary.uuid ||
      message.type !== 'system' ||
      record?.type !== 'system' ||
      record.subtype !== 'compact_boundary'
    )
      throw new Error('unsupported_checkpoint')
  }
}

void run(workerData as ValidationInput).then(
  () => parentPort?.postMessage({ result: null }),
  (error) => parentPort?.postMessage({ error: error instanceof Error ? error.message : 'history_corrupt' })
)
