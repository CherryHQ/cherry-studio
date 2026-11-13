import { realpathSync } from 'node:fs'
import { isAbsolute, parse } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { parseArgs } from 'node:util'

import { SandboxManager } from '@cherrystudio/sandbox'
import type { SandboxSpec } from '@cherrystudio/sandbox/types'

import { completionExitCode } from './completionExitCode.js'

const help = `Sandbox CLI — uses the package's public SandboxManager API.
Usage: pnpm --filter @cherrystudio/sandbox lab <probe|run> [options] -- /absolute/executable [args...]

  probe                 Print the backend assessment without executing
  run                   Start through SandboxManager; refuse unavailable backends
  --read PATH           Grant reads (repeatable)
  --write PATH          Grant reads and writes (repeatable)
  --deny-read PATH      Deny reads inside grants (repeatable)
  --deny-write PATH     Deny writes inside grants (repeatable)
  --cwd PATH            Working directory (default: current drive root); does not grant access
  --timeout-ms N        Command lifetime (default: 10000)
  --help                Show this help

Paths must exist and are canonicalized. Arguments stay literal; host environment is not inherited.
Current profile: mxc-command-v1, network=deny, channel=none.
MXC path grants and process-group cleanup apply; see probe limitations.
Exit: target code, 124 resource limit, 125 unavailable/setup/CLI failure, 128+signal on interruption.
`

async function main() {
  const args = process.argv.slice(2)
  const separator = args.indexOf('--')
  const { values, positionals } = parseArgs({
    args: separator < 0 ? args : args.slice(0, separator),
    allowPositionals: true,
    options: {
      help: { type: 'boolean' },
      read: { type: 'string', multiple: true },
      write: { type: 'string', multiple: true },
      'deny-read': { type: 'string', multiple: true },
      'deny-write': { type: 'string', multiple: true },
      cwd: { type: 'string', default: parse(process.cwd()).root },
      'timeout-ms': { type: 'string', default: '10000' }
    }
  })
  if (values.help) {
    process.stdout.write(help)
    return 0
  }
  const [mode] = positionals
  const command = separator < 0 ? [] : args.slice(separator + 1)
  if (positionals.length !== 1 || !['probe', 'run'].includes(mode) || !command[0] || !isAbsolute(command[0])) {
    throw new Error('Expected probe or run, options, then -- /absolute/executable [args...]; see --help')
  }
  const canonicalPath = (entry: string) => {
    if (process.platform === 'win32' && (/^[\\/]{2}/.test(entry) || entry.slice(2).includes(':')))
      throw new Error('Sandbox paths must be local paths without device prefixes or alternate data streams')
    return realpathSync(entry)
  }
  const paths = (entries: string[] = []) => entries.map(canonicalPath)
  const spec: SandboxSpec & { channel: 'none' } = {
    ownerId: 'sandbox-cli',
    environmentId: 'native',
    runtimeProfileId: 'mxc-command-v1',
    command: { executable: canonicalPath(command[0]), args: command.slice(1), cwd: canonicalPath(values.cwd), env: {} },
    filesystem: {
      read: paths(values.read),
      write: paths(values.write),
      denyRead: paths(values['deny-read']),
      denyWrite: paths(values['deny-write'])
    },
    network: { mode: 'deny' },
    channel: 'none',
    limits: {
      startupTimeoutMs: 5000,
      lifetimeMs: Number(values['timeout-ms']),
      stopGraceMs: 100,
      stopTimeoutMs: 1500,
      cleanupTimeoutMs: 1000,
      ioDrainTimeoutMs: 500,
      ioBufferBytes: 65536,
      outputBytes: 1048576
    }
  }
  const sandbox = new SandboxManager()
  try {
    if (mode === 'probe') {
      const assessment = await sandbox.probe(spec)
      process.stdout.write(`${JSON.stringify(assessment, null, 2)}\n`)
      return assessment.status === 'ready' ? 0 : 125
    }
    return await run(sandbox, spec)
  } finally {
    await sandbox.dispose()
  }
}

async function run(sandbox: SandboxManager, spec: SandboxSpec & { channel: 'none' }) {
  const cancellation = new AbortController()
  let interrupted: NodeJS.Signals | undefined
  const onSignal = (signal: NodeJS.Signals) => {
    interrupted ??= signal
    cancellation.abort()
  }
  process.on('SIGINT', onSignal).on('SIGTERM', onSignal)
  const instance = sandbox.start(spec, { signal: cancellation.signal })
  const inputAbort = new AbortController()
  const outputAbort = new AbortController()
  let ioFailed = false
  const failIo = () => {
    ioFailed = true
    void instance.stop()
  }
  const output = Promise.all([
    pipeline(instance.stdout, process.stdout, { end: false, signal: outputAbort.signal }),
    pipeline(instance.stderr, process.stderr, { end: false, signal: outputAbort.signal })
  ]).catch(failIo)
  const input = instance.ready.then(
    async () => {
      await pipeline(
        process.stdin,
        async (source) => {
          for await (const chunk of source) await instance.stdin.write(chunk)
          await instance.stdin.end()
        },
        { signal: inputAbort.signal }
      ).catch(() => {
        if (!inputAbort.signal.aborted) failIo()
      })
    },
    () => undefined
  )
  let drainTimer: ReturnType<typeof setTimeout> | undefined
  try {
    const completion = await instance.completion
    inputAbort.abort()
    drainTimer = setTimeout(() => outputAbort.abort(), spec.limits.ioDrainTimeoutMs)
    await Promise.all([input, output])
    process.stderr.write(`${JSON.stringify({ completion })}\n`)
    return completionExitCode(completion, ioFailed, interrupted)
  } finally {
    clearTimeout(drainTimer)
    inputAbort.abort()
    outputAbort.abort()
    await instance.stop()
    await Promise.all([input, output])
    process.off('SIGINT', onSignal).off('SIGTERM', onSignal)
  }
}

try {
  process.exitCode = await main()
} catch (error) {
  process.stderr.write(`sandbox-lab: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 125
}
