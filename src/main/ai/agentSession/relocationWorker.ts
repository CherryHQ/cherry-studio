import { parentPort, workerData } from 'node:worker_threads'

export interface RelocationWorkerInput {
  oldCwd: string
  newCwd: string
  dsh?: { modulePath: string; sourceRoot: string; targetRoot: string }
}

async function run(input: RelocationWorkerInput) {
  const { getSessionInfo } = await import('@anthropic-ai/claude-agent-sdk')
  async function projectKey(dir: string) {
    let result: string | undefined
    await getSessionInfo('00000000-0000-4000-8000-000000000001', {
      dir,
      sessionStore: {
        async load(key) {
          result = key.projectKey
          return null
        },
        async append() {
          throw new Error('Unexpected Claude history write')
        }
      }
    })
    if (!result || /[\\/]/.test(result) || result === '.' || result === '..') {
      throw new Error('Invalid Claude project key')
    }
    return result
  }
  const oldKey = await projectKey(input.oldCwd)
  const newKey = await projectKey(input.newCwd)
  const dsh = input.dsh
    ? await (await import(/* @vite-ignore */ input.dsh.modulePath)).stageRelocatedSessions({ ...input, ...input.dsh })
    : []
  return { oldKey, newKey, dsh }
}

void run(workerData as RelocationWorkerInput).then(
  (result) => parentPort?.postMessage({ result }),
  (error) => parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) })
)
