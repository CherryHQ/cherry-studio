import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { connect, createServer, type Socket } from 'node:net'

import { app } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'

const logger = loggerService.withContext('SingleInstance')

// A random Windows pipe is a transient reply channel, not a second data-directory lock.
function probePipe(id: string): string {
  return `\\\\.\\pipe\\cherry-startup-${id}`
}

/** Runs after path resolution/registry initialization and before any user-data operation. */
export async function requireSingleInstance(): Promise<boolean> {
  if (process.platform !== 'win32') {
    if (app.requestSingleInstanceLock()) return true
    application.forceExit(0)
    return false
  }
  const probe = randomUUID()
  const sockets = new Set<Socket>()
  let acknowledge!: () => void
  const acknowledged = new Promise<void>((resolve) => {
    acknowledge = resolve
  })
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => socket.destroy())
    socket.once('close', () => sockets.delete(socket))
    let reply = ''
    socket.on('data', (chunk) => {
      reply += chunk.toString()
      if (reply === 'ready') acknowledge()
      if (reply.length >= 5) socket.destroy()
    })
  })
  let timeout: ReturnType<typeof setTimeout> | undefined
  let retry = false
  try {
    server.listen(probePipe(probe))
    await once(server, 'listening')
    if (app.requestSingleInstanceLock({ startupProbe: probe })) {
      const respond = (_event: Electron.Event, _argv: string[], _cwd: string, data: unknown): void => {
        if (!data || typeof data !== 'object' || !('startupProbe' in data)) return
        if (typeof data.startupProbe !== 'string' || !/^[a-f0-9-]{36}$/.test(data.startupProbe)) return
        const socket = connect(probePipe(data.startupProbe))
        socket.on('error', (error) => logger.debug('Startup probe no longer available', error))
        socket.setTimeout(1000, () => socket.destroy())
        socket.once('connect', () => socket.end('ready'))
      }
      app.on('second-instance', respond)
      app.once('will-quit', () => app.removeListener('second-instance', respond))
      return true
    }
    const responded = await Promise.race([
      acknowledged.then(() => true),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), 5000)
      })
    ])
    if (!responded) {
      // Older versions cannot acknowledge probes; timeout alone never authorizes termination.
      const { showStartupRecovery } = await import('@main/services/startupRecovery')
      retry =
        (await showStartupRecovery({ code: 'SQLITE_BUSY' }, application.getPath('app.database.file'), true)) === 'retry'
    }
  } finally {
    clearTimeout(timeout)
    for (const socket of sockets) socket.destroy()
    server.close()
  }
  if (retry) application.relaunch()
  else application.forceExit(0)
  return false
}
