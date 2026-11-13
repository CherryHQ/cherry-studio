import { mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import { within } from '../host/deferred.js'
import type { SandboxManager } from '../host/SandboxManager.js'
import type { JsonObject, JsonValue, RpcSandboxInstance, SandboxCompletion, SandboxSpec } from '../types.js'

export type DiagnosticGroup = 'files' | 'rpc' | 'instances' | 'network'
export interface DiagnosticResult {
  id: string
  status: 'passed' | 'failed' | 'unsupported' | 'cancelled' | 'inconclusive'
  expected: string
  actual: string
}

export type DiagnosticInteraction =
  | { kind: 'rpc'; value: number; allowCallback: boolean }
  | { kind: 'network'; url: string; allowedOrigins: string[] }
export interface DiagnosticStep {
  step: 'policy' | 'request' | 'callback' | 'callback-result' | 'response' | 'error' | 'cleanup'
  elapsedMs: number
  detail: string
}

/** Runs owned fixtures through the public manager. The caller owns the temporary root. */
export async function runDiagnostics(
  manager: SandboxManager,
  group: DiagnosticGroup,
  base: SandboxSpec,
  signal: AbortSignal,
  interaction?: DiagnosticInteraction
) {
  if (interaction && interaction.kind !== group) throw new Error('Mismatched diagnostic group')
  const trace: DiagnosticStep[] = []
  const began = Date.now()
  const record = (step: DiagnosticStep['step'], detail: unknown) => {
    if (interaction) trace.push({ step, elapsedMs: Date.now() - began, detail: JSON.stringify(detail, null, 2) })
  }
  const results: DiagnosticResult[] = []
  const instances: RpcSandboxInstance[] = []
  const completions: SandboxCompletion[] = []
  const stderr: Promise<string>[] = []
  const servers: Server[] = []
  const root = base.command.cwd
  const add = (id: string, expected: unknown, actual: unknown, passed: boolean) => {
    results.push({
      id,
      status: passed ? 'passed' : 'failed',
      expected: JSON.stringify(expected),
      actual: JSON.stringify(actual)
    })
  }
  const call = (instance: RpcSandboxInstance, method: string, params: JsonObject) =>
    instance.rpc.request(method, params, { signal, timeoutMs: 4000 })
  const field = (value: JsonValue, key: string) =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? value[key] : undefined
  const denied = (value: JsonValue) => ['EACCES', 'EPERM'].includes(String(field(value, 'error')))
  let forbiddenCalls = 0
  let started!: () => void
  let cancelled!: () => void
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve
  })
  const cancelledPromise = new Promise<void>((resolve) => {
    cancelled = resolve
  })
  const launch = async (name: string, extraRead: string[] = [], network: SandboxSpec['network'] = { mode: 'deny' }) => {
    signal.throwIfAborted()
    const cwd = path.join(root, name)
    await mkdir(cwd)
    const script = path.join(cwd, 'guest.cjs')
    await writeFile(script, await readFile(new URL(import.meta.resolve('#diagnostic-guest'))), { mode: 0o600 })
    const spec = {
      ...base,
      command: {
        ...base.command,
        cwd,
        args: ['--preserve-symlinks-main', script],
        env: { ...base.command.env, TMP: cwd, TEMP: cwd }
      },
      filesystem: { ...base.filesystem, read: [...base.filesystem.read, ...extraRead], write: [cwd] },
      network,
      channel: 'stdio' as const
    }
    const assessment = await manager.probe(spec)
    if (assessment.status !== 'ready') {
      results.push({ id: 'backend', status: 'unsupported', expected: 'ready', actual: JSON.stringify(assessment) })
      record('error', assessment)
      return null
    }
    const instance = manager.start(spec, {
      signal,
      rpc: {
        authorize: async ({ method }) =>
          interaction?.kind === 'rpc'
            ? interaction.allowCallback && method === 'host.double'
            : ['host.double', 'host.started', 'host.cancelled'].includes(method),
        configure(peer) {
          peer.handle('host.double', async ({ value }) => {
            if (typeof value !== 'number') throw new Error('Expected number')
            record('callback', { method: 'host.double', params: { value } })
            record('callback-result', value * 2)
            return value * 2
          })
          peer.handle('host.secret', async () => {
            forbiddenCalls++
            return 'secret'
          })
          peer.handle('host.started', async () => {
            started()
            return null
          })
          peer.handle('host.cancelled', async () => {
            cancelled()
            return null
          })
        }
      }
    })
    instances.push(instance)
    stderr.push(
      (async () => {
        let text = ''
        for await (const chunk of instance.stderr) text += Buffer.from(chunk).toString()
        return text.slice(0, 8192)
      })()
    )
    await instance.ready
    return instance
  }
  try {
    if (interaction) {
      const network: SandboxSpec['network'] =
        interaction.kind === 'network'
          ? {
              mode: 'proxy',
              targets: interaction.allowedOrigins.map((origin) => {
                const url = new URL(origin)
                return { host: url.hostname, port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)) }
              })
            }
          : { mode: 'deny' }
      record(
        'policy',
        interaction.kind === 'network'
          ? network
          : { allowedHostMethods: interaction.allowCallback ? ['host.double'] : [] }
      )
      const instance = await launch('interactive', [], network)
      if (instance) {
        const method = interaction.kind === 'rpc' ? 'compute' : 'fetch'
        const params: JsonObject = interaction.kind === 'rpc' ? { value: interaction.value } : { url: interaction.url }
        record('request', { method, params })
        const response = await instance.rpc.request(method, params, { signal, timeoutMs: 10000 })
        record('response', response)
      }
    } else if (group === 'files') {
      const readOnly = path.join(root, 'readonly')
      const privateDir = path.join(root, 'workspace-sibling')
      await mkdir(readOnly)
      await mkdir(privateDir)
      const ro = path.join(readOnly, 'file.txt'),
        hidden = path.join(privateDir, 'file.txt')
      await writeFile(ro, 'read-only')
      await writeFile(hidden, 'private')
      const instance = await launch('workspace', [readOnly])
      if (instance) {
        const file = path.join(root, 'workspace', 'file.txt')
        await writeFile(file, 'before')
        const fd = await open(file, 'r')
        try {
          const response = await call(instance, 'write', { path: file, text: 'after' })
          const bytes = Buffer.alloc(5)
          await fd.read(bytes, 0, 5, 0)
          add(
            'direct-write',
            'after visible through pre-opened host descriptor',
            { response, text: bytes.toString() },
            bytes.toString() === 'after'
          )
        } finally {
          await fd.close()
        }
        const readable = await call(instance, 'read', { path: ro })
        add('readonly-read', { text: 'read-only' }, readable, isDeepStrictEqual(readable, { text: 'read-only' }))
        const blockedWrite = await call(instance, 'write', { path: ro, text: 'changed' })
        const original = await readFile(ro, 'utf8')
        add(
          'readonly-write',
          'permission denied; file unchanged',
          { blockedWrite, original },
          denied(blockedWrite) && original === 'read-only'
        )
        const blockedRead = await call(instance, 'read', { path: hidden })
        add('outside-read', 'permission denied on existing sibling file', blockedRead, denied(blockedRead))
        const blockedOutsideWrite = await call(instance, 'write', { path: hidden, text: 'changed' })
        const unchanged = await readFile(hidden, 'utf8')
        add(
          'outside-write',
          'permission denied; file unchanged',
          { blockedOutsideWrite, unchanged },
          denied(blockedOutsideWrite) && unchanged === 'private'
        )
      }
    } else if (group === 'rpc') {
      const instance = await launch('rpc')
      if (instance) {
        const value = await call(instance, 'compute', { value: 20 })
        add('nested-callback', 41, value, value === 41)
        const rejected = await call(instance, 'forbidden', {})
        add(
          'authorization',
          'Access denied; host handler never runs',
          { rejected, forbiddenCalls },
          JSON.stringify(rejected).includes('Access denied') && forbiddenCalls === 0
        )
        const order: JsonValue[] = []
        await Promise.all([
          call(instance, 'delay', { ms: 150, value: 'slow' }).then((v) => order.push(v)),
          call(instance, 'delay', { ms: 0, value: 'fast' }).then((v) => order.push(v))
        ])
        add('concurrent-requests', ['fast', 'slow'], order, isDeepStrictEqual(order, ['fast', 'slow']))
        const controller = new AbortController()
        const pending = instance.rpc
          .request('cancel', {}, { signal: AbortSignal.any([signal, controller.signal]) })
          .then(
            () => false,
            () => true
          )
        if (
          !(await within(
            startedPromise.then(() => true),
            4000,
            false
          ))
        )
          throw new Error('Callback deadline')
        controller.abort()
        const wasCancelled = await pending
        if (
          !(await within(
            cancelledPromise.then(() => true),
            4000,
            false
          ))
        )
          throw new Error('Cancellation deadline')
        const echo = await call(instance, 'echo', { recovered: true })
        add(
          'cancellation-recovery',
          'guest observes cancellation; next request succeeds',
          { wasCancelled, echo },
          wasCancelled && isDeepStrictEqual(echo, { recovered: true })
        )
      }
    } else if (group === 'instances') {
      const a = await launch('a'),
        b = a ? await launch('b') : null
      if (a && b) {
        const bFile = path.join(root, 'b', 'owned.txt')
        await call(b, 'write', { path: bFile, text: 'B' })
        const bRead = await call(b, 'read', { path: bFile })
        const deniedA = await call(a, 'read', { path: bFile })
        add(
          'separate-grants',
          'B reads its file; A cannot read B workspace',
          { bRead, deniedA },
          field(bRead, 'text') === 'B' && denied(deniedA)
        )
        const completion = await a.stop()
        const echo = await call(b, 'echo', { alive: 'B' })
        add(
          'independent-stop',
          'A stopped; B still responds',
          { state: a.snapshot().state, completion, echo },
          a.snapshot().state === 'stopped' && isDeepStrictEqual(echo, { alive: 'B' })
        )
      }
    } else {
      let allowedHits = 0,
        deniedHits = 0
      const listen = async (server: Server) => {
        servers.push(server)
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject)
          server.listen(0, '127.0.0.1', resolve)
        })
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Missing fixture address')
        return address.port
      }
      const blockedPort = await listen(
        createServer((_, response) => {
          deniedHits++
          response.end('blocked-target')
        })
      )
      const allowedPort = await listen(
        createServer((request, response) => {
          allowedHits++
          if (request.url === '/redirect') {
            response.writeHead(302, { location: `http://127.0.0.1:${blockedPort}/` })
            response.end()
          } else response.end('allowed-target')
        })
      )
      const allowedUrl = `http://127.0.0.1:${allowedPort}/`,
        blockedUrl = `http://127.0.0.1:${blockedPort}/`
      const controls = await Promise.all([
        fetch(allowedUrl, { signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]) }).then((r) => r.text()),
        fetch(blockedUrl, { signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]) }).then((r) => r.text())
      ])
      if (controls[0] !== 'allowed-target' || controls[1] !== 'blocked-target')
        throw new Error('Host reachability control failed')
      allowedHits = 0
      deniedHits = 0
      const instance = await launch('network', [], {
        mode: 'proxy',
        targets: [{ host: '127.0.0.1', port: allowedPort }]
      })
      if (instance) {
        const allowed = await call(instance, 'http', { url: allowedUrl })
        add(
          'allowlisted-http',
          '200 allowed-target; one destination hit',
          { allowed, allowedHits },
          field(allowed, 'status') === 200 && field(allowed, 'body') === 'allowed-target' && allowedHits === 1
        )
        const blocked = await call(instance, 'http', { url: blockedUrl })
        add(
          'unlisted-port',
          '403; zero destination hits',
          { blocked, deniedHits },
          field(blocked, 'status') === 403 && deniedHits === 0
        )
        const host = await call(instance, 'http', { url: `http://localhost:${allowedPort}/` })
        add('unlisted-host', '403', host, field(host, 'status') === 403)
        const tunnel = await call(instance, 'http', { url: allowedUrl, connect: true })
        const deniedTunnel = await call(instance, 'http', { url: blockedUrl, connect: true })
        add(
          'connect-policy',
          'allowed CONNECT 200; unlisted CONNECT 403',
          { tunnel, deniedTunnel },
          field(tunnel, 'status') === 200 && field(deniedTunnel, 'status') === 403
        )
        const redirect = await call(instance, 'http', { url: allowedUrl + 'redirect' })
        const location = field(redirect, 'location')
        if (location !== blockedUrl) throw new Error('Unexpected fixture redirect')
        const followed = await call(instance, 'http', { url: location })
        add(
          'redirect-policy',
          '302 to unlisted target; follow-up 403; zero destination hits',
          { redirect, followed, deniedHits },
          field(redirect, 'status') === 302 && field(followed, 'status') === 403 && deniedHits === 0
        )
        const direct = await call(instance, 'http', { url: allowedUrl, direct: true })
        add('direct-bypass', 'OS permission denial against reachable listener', direct, denied(direct))
        if (!denied(direct) && field(direct, 'error') === 'timeout') results[results.length - 1].status = 'inconclusive'
      }
    }
  } catch (error) {
    record('error', String(error))
    results.push({
      id: group,
      status: signal.aborted ? 'cancelled' : 'failed',
      expected: 'scenario completed',
      actual: String(error)
    })
  } finally {
    completions.push(...(await Promise.all(instances.map((instance) => instance.stop()))))
    for (const server of servers) {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
  const removable = completions.every(
    (completion) => completion.tree !== 'unknown' && completion.cleanup === 'complete'
  )
  if (instances.length) record('cleanup', completions)
  if (instances.length) add('cleanup', 'all targets stopped; adapter resources released', completions, removable)
  return {
    results,
    trace,
    removable,
    report: JSON.stringify({ completions, stderr: await Promise.all(stderr) }, null, 2)
  }
}
