import { realpathSync } from 'node:fs'
import path from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'

export interface RelocationWorkerInput {
  oldCwd: string
  newCwd: string
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
  let newCwd = input.newCwd
  // Match the SDK's realpathSync semantics; native/async realpath expands Windows short names.
  for (;;) {
    try {
      newCwd = path.join(realpathSync(newCwd), path.relative(newCwd, input.newCwd))
      break
    } catch (error) {
      const parent = path.dirname(newCwd)
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || parent === newCwd) throw error
      newCwd = parent
    }
  }
  const newKey = await projectKey(newCwd)
  return { oldKey, newKey }
}

void run(workerData as RelocationWorkerInput).then(
  (result) => parentPort?.postMessage({ result }),
  (error) => parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) })
)
