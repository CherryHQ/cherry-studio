import type { LaunchSpec, SpawnStdio } from '@cherrystudio/agent-runtime/stdio'

import type { AcpClient } from './client'

export function launchAcpStdio<T extends Pick<AcpClient, 'signal' | 'close'>>(
  spec: LaunchSpec,
  spawn: SpawnStdio,
  attach: (process: Pick<ReturnType<SpawnStdio>, 'stdin' | 'stdout'>) => T,
  onExit: (error: Error) => void
) {
  const process = spawn(spec)
  let stderr = ''
  process.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-4000)
  })
  let closing: Promise<void> | undefined
  let client: T
  try {
    client = attach(process)
  } catch (error) {
    void process.closeAndJoin().catch(() => {})
    throw error
  }

  void process.closed.then((result) => {
    if (closing) return
    const error = result.kind === 'spawn-failed' ? result.error : new Error('Local agent process exited')
    client.close(error)
    onExit(error)
  })

  return {
    client,
    get stderr() {
      return stderr
    },
    close(closeSession?: () => Promise<unknown>, report?: (error: unknown) => void) {
      return (closing ??= stop(closeSession, report).catch((error: unknown) => {
        closing = undefined
        throw error
      }))
    }
  }

  async function stop(closeSession?: () => Promise<unknown>, report?: (error: unknown) => void) {
    if (closeSession && !client.signal.aborted) {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          closeSession(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('ACP session close timed out')), 2000)
          })
        ])
      } catch (error) {
        report?.(error)
      } finally {
        clearTimeout(timer)
      }
    }
    client.close()
    await process.closeAndJoin()
  }
}
