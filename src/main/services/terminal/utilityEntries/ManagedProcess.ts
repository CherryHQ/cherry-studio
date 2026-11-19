import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer, type Socket } from 'node:net'

import { spawn as spawnPty, type IPty } from 'node-pty'
import * as z from 'zod'

import type { TerminalCleanup, TerminalLaunch, TerminalResourceId } from '../contracts'

const nativeEvent = z.object({
  event: z.enum(['ready', 'running', 'exit', 'empty', 'error']),
  scopeId: z.uuid(),
  value: z.number().int(),
  signal: z.number().int().nonnegative()
})
export interface ManagedProcessOptions {
  id: TerminalResourceId
  helperFile: string
  launch: TerminalLaunch
  onOutput: (data: Uint8Array, source: 'stdout' | 'stderr' | 'terminal') => void
  onExit: (exitCode: number | null, signal: number | null) => void
  onClosed: (cleanup: TerminalCleanup) => void
  onFault: (error: Error) => void
}

export class ManagedProcess {
  private readonly server = createServer((socket) => this.connect(socket))
  private readonly started = Promise.withResolvers<void>()
  private readonly ended = Promise.withResolvers<TerminalCleanup>()
  private socket?: Socket
  private pipe?: ChildProcessWithoutNullStreams
  private pty?: IPty
  private stopRequested = false
  private forceRequested = false
  private empty = false
  private finished = false
  private launched = false
  private running = false
  private rootExited = false
  private startPromise?: Promise<void>
  private closing?: Promise<TerminalCleanup>
  private readonly connections = new Set<Socket>()

  constructor(private readonly options: ManagedProcessOptions) {
    this.server.maxConnections = 2
    this.server.on('error', (error) => this.fail(error))
    void this.started.promise.catch(() => {})
  }

  start(): Promise<void> {
    return (this.startPromise ??= this.launch())
  }

  private async launch(): Promise<void> {
    const timer = setTimeout(() => this.fail(new Error('Terminal scope startup timed out')), 10_000)
    timer.unref()
    try {
      await new Promise<void>((resolve, reject) => {
        this.server.once('error', reject)
        this.server.listen(0, '127.0.0.1', () => {
          this.server.off('error', reject)
          resolve()
        })
      })
      if (this.stopRequested) {
        this.finish('confirmed')
        throw new Error('Terminal scope is closing')
      }
      const address = this.server.address()
      if (address === null || typeof address === 'string') throw new Error('Terminal scope listener is unavailable')
      const { launch, helperFile, id } = this.options
      const args = [String(address.port), id, launch.kind, '--', launch.file, ...launch.args]
      if (launch.kind === 'pipe') {
        const child = spawn(helperFile, args, {
          cwd: launch.cwd,
          env: launch.env,
          detached: process.platform !== 'win32',
          windowsHide: true,
          stdio: 'pipe'
        })
        this.pipe = child
        child.stdout.on('data', (data: Buffer) => this.options.onOutput(data, 'stdout'))
        child.stderr.on('data', (data: Buffer) => this.options.onOutput(data, 'stderr'))
        child.stdin.on('error', (error) => {
          if (!this.stopRequested) this.options.onFault(error)
        })
        child.once('spawn', () => {
          this.launched = true
        })
        child.once('error', (error) => {
          this.fail(error)
          if (!this.launched) this.finish('confirmed')
        })
        child.once('close', () => this.finish(this.empty ? 'confirmed' : 'unconfirmed'))
      } else {
        this.launched = true
        this.pty = spawnPty(helperFile, args, {
          cwd: launch.cwd,
          env: launch.env,
          cols: launch.cols,
          rows: launch.rows,
          name: 'xterm-256color',
          handleFlowControl: false,
          useConpty: true
        })
        this.launched = true
        this.pty.onData((data) => this.options.onOutput(Buffer.from(data, 'utf8'), 'terminal'))
        this.pty.onExit(() => this.finish(this.empty ? 'confirmed' : 'unconfirmed'))
      }
      await this.started.promise
      if (launch.kind === 'pipe') this.pipe?.stdin.end(launch.stdin)
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      this.fail(error)
      if (!this.launched && !this.pipe) this.finish('confirmed')
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  private connect(socket: Socket): void {
    this.connections.add(socket)
    let buffer = ''
    socket.on('error', (error) => {
      if (socket === this.socket && !this.finished) this.fail(error)
    })
    socket.on('close', () => {
      this.connections.delete(socket)
      if (socket === this.socket && !this.empty && !this.finished)
        this.fail(new Error('Terminal scope control disconnected'))
    })
    socket.on('data', (data: Buffer) => {
      buffer += data.toString('utf8')
      if (buffer.length > 4096) {
        if (socket === this.socket) this.fail(new Error('Terminal scope frame exceeds limit'))
        socket.destroy()
        return
      }
      for (let newline = buffer.indexOf('\n'); newline !== -1; newline = buffer.indexOf('\n')) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        try {
          const frame = nativeEvent.parse(JSON.parse(line))
          if (frame.scopeId !== this.options.id || (this.socket && this.socket !== socket)) {
            socket.destroy()
            return
          }
          if (!this.socket) {
            if (frame.event !== 'ready') {
              socket.destroy()
              return
            }
            this.socket = socket
            this.server.close()
          }
          switch (frame.event) {
            case 'ready':
              socket.write(this.stopRequested ? 'K' : 'S')
              break
            case 'running':
              this.running = true
              this.started.resolve()
              break
            case 'exit':
              if (this.rootExited) throw new Error('Duplicate terminal root exit')
              this.rootExited = true
              this.options.onExit(frame.value === -1 ? null : frame.value, frame.signal || null)
              break
            case 'empty':
              if (!this.rootExited) throw new Error('Terminal scope reported empty before root exit')
              this.empty = true
              break
            case 'error':
              this.fail(new Error(`Terminal scope backend failed (${frame.value})`))
              break
          }
        } catch (cause) {
          const error = cause instanceof Error ? cause : new Error(String(cause))
          if (socket === this.socket) this.fail(error)
          else socket.destroy()
        }
      }
    })
  }

  private fail(error: Error): void {
    if (this.finished) return
    this.started.reject(error)
    this.options.onFault(error)
    void this.close()
  }

  private finish(cleanup: TerminalCleanup): void {
    if (this.finished) return
    this.finished = true
    this.started.reject(new Error('Terminal scope exited before startup acknowledgement'))
    if (this.server.listening) this.server.close()
    for (const socket of this.connections) socket.destroy()
    this.ended.resolve(cleanup)
    this.options.onClosed(cleanup)
  }

  close(): Promise<TerminalCleanup> {
    if (this.finished) return this.ended.promise
    if (this.closing) return this.closing
    this.stopRequested = true
    if (!this.startPromise) {
      this.finish('confirmed')
      return this.ended.promise
    }
    this.socket?.write(this.forceRequested ? 'K' : 'T')
    this.closing = new Promise<TerminalCleanup>((resolve) => {
      const force = setTimeout(() => {
        this.forceRequested = true
        this.socket?.write('K')
      }, 3000)
      const deadline = setTimeout(() => resolve('unconfirmed'), 5000)
      force.unref()
      deadline.unref()
      void this.ended.promise.then((cleanup) => {
        clearTimeout(force)
        clearTimeout(deadline)
        resolve(cleanup)
      })
    }).finally(() => {
      this.closing = undefined
    })
    return this.closing
  }

  async write(data: string): Promise<void> {
    if (this.stopRequested || this.finished || !this.pty) throw new Error('Terminal scope is not writable')
    if (!this.running) await this.started.promise
    if (this.stopRequested || this.finished) throw new Error('Terminal scope is not writable')
    return this.pty.writeAsync(data)
  }

  resize(cols: number, rows: number): void {
    if (this.stopRequested || this.finished || !this.pty) throw new Error('Terminal scope is not resizable')
    this.pty.resize(cols, rows)
  }
}
