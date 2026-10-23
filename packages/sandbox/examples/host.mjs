import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'

import { SandboxManager } from '@cherrystudio/sandbox'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'cherry-sandbox-demo-')))
const allowed = join(root, 'allowed')
mkdirSync(allowed)
writeFileSync(join(allowed, 'input'), 'sandbox demo\n')
writeFileSync(join(root, 'secret'), 'outside the grant\n')
const sandbox = new SandboxManager()
const spec = {
  ownerId: 'demo',
  environmentId: 'native',
  runtimeProfileId: 'mxc-command-v1',
  command: {
    executable: realpathSync(process.execPath),
    cwd: parse(root).root,
    env: {},
    args: [
      '-e',
      `const fs = require('node:fs'); const path = require('node:path'); const allowed = process.argv[1];
       fs.writeFileSync(path.join(allowed, 'output'), fs.readFileSync(path.join(allowed, 'input'), 'utf8').trim());
       try { fs.readFileSync(process.argv[2]); process.exit(20) }
       catch (error) { if (!['EACCES', 'EPERM'].includes(error.code)) throw error }
       process.stdout.write('allowed I/O succeeded; outside read denied\\n')`,
      allowed,
      join(root, 'secret')
    ]
  },
  filesystem: { read: [], write: [allowed], denyRead: [], denyWrite: [] },
  network: { mode: 'deny' },
  channel: 'none',
  limits: {
    startupTimeoutMs: 5000,
    lifetimeMs: 5000,
    stopGraceMs: 100,
    stopTimeoutMs: 1000,
    cleanupTimeoutMs: 1000,
    ioDrainTimeoutMs: 500,
    ioBufferBytes: 65536,
    outputBytes: 65536
  }
}
let safelyStopped = false
try {
  const probe = await sandbox.probe(spec)
  process.stdout.write(`${JSON.stringify(probe, null, 2)}\n`)
  if (probe.status !== 'ready') {
    process.stdout.write('Sandbox unavailable: target was not executed.\n')
    process.exitCode = 1
  } else {
    const instance = sandbox.start(spec)
    const drain = async (stream, destination) => {
      for await (const chunk of stream) destination.write(chunk)
    }
    const output = Promise.all([drain(instance.stdout, process.stdout), drain(instance.stderr, process.stderr)])
    const ready = await instance.ready
    const completion = await instance.completion
    await output
    safelyStopped = completion.tree !== 'unknown' && completion.cleanup === 'complete'
    process.stdout.write(`${JSON.stringify({ backend: ready.backendId, completion }, null, 2)}\n`)
    assert.equal(completion.target.exitCode, 0)
    assert.equal(readFileSync(join(allowed, 'output'), 'utf8'), 'sandbox demo')
    assert.equal(safelyStopped, true)
  }
} finally {
  const stopped = await sandbox.dispose()
  if (safelyStopped || stopped.every((result) => result.tree !== 'unknown' && result.cleanup === 'complete')) {
    rmSync(root, { recursive: true, force: true })
  }
}
