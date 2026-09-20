import { parentPort, workerData } from 'node:worker_threads'

export interface DshForkWorkerInput {
  modulePath: string
  sourceRoot: string
  targetRoot: string
  sourceSessionId: string
  targetSessionId: string
  targetCwd: string
  boundary: number
  checkpoints: Array<{ boundary: number }>
  events?: unknown[]
}

async function run(input: DshForkWorkerInput): Promise<unknown> {
  const sdk = await import(/* @vite-ignore */ input.modulePath)
  return sdk.forkSession(input)
}

void run(workerData as DshForkWorkerInput).then(
  (result) => parentPort?.postMessage({ result }),
  (error) =>
    parentPort?.postMessage({
      error:
        (error as NodeJS.ErrnoException)?.code === 'ENOENT'
          ? 'history_missing'
          : error instanceof SyntaxError
            ? 'history_corrupt'
            : error instanceof Error
              ? error.message
              : 'history_corrupt'
    })
)
