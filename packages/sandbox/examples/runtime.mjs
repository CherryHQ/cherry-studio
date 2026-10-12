import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export function runtime(python = false) {
  if (!python) return { executable: realpathSync(process.execPath), read: [dirname(realpathSync(process.execPath))] }
  const command = process.env.SANDBOX_PYTHON ?? (process.platform === 'win32' ? 'python.exe' : '/usr/bin/xcrun')
  const args =
    process.platform === 'darwin' && !process.env.SANDBOX_PYTHON
      ? ['python3', '-c', 'import sys; print(sys.executable)']
      : ['-c', 'import sys; print(sys.executable)']
  const executable = realpathSync(
    execFileSync(command, args, { encoding: 'utf8', timeout: 10000, windowsHide: true }).trim()
  )
  return { executable, read: [process.platform === 'win32' ? dirname(executable) : dirname(dirname(executable))] }
}

export function prepareRpc(packageRoot, python = false) {
  const selectedRuntime = runtime(python)
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cherry-rpc-')))
  mkdirSync(join(root, 'examples'))
  const guest = python ? 'rpcGuest.py' : 'rpcGuest.mjs'
  cpSync(join(packageRoot, 'examples', guest), join(root, 'examples', guest))
  if (!python) {
    cpSync(join(packageRoot, 'dist/src/rpc'), join(root, 'dist/src/rpc'), { recursive: true })
    cpSync(join(packageRoot, 'package.json'), join(root, 'package.json'))
    mkdirSync(join(root, 'node_modules'))
    cpSync(realpathSync(join(packageRoot, 'node_modules/vscode-jsonrpc')), join(root, 'node_modules/vscode-jsonrpc'), {
      recursive: true
    })
  }
  return {
    spec: rpcSpec(root, python, selectedRuntime),
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true })
  }
}

/** @returns {import('../src/types.js').SandboxSpec & { channel: 'stdio' }} */
function rpcSpec(packageRoot, python, { executable, read }) {
  return {
    ownerId: 'rpc-demo',
    environmentId: 'native',
    runtimeProfileId: 'mxc-command-v1',
    command: {
      executable,
      args: [
        ...(!python && process.platform === 'win32' ? ['--preserve-symlinks', '--preserve-symlinks-main'] : []),
        join(packageRoot, 'examples', python ? 'rpcGuest.py' : 'rpcGuest.mjs')
      ],
      cwd: packageRoot,
      env: {}
    },
    filesystem: { read: [packageRoot, ...read], write: [], denyRead: [], denyWrite: [] },
    network: { mode: 'deny' },
    channel: 'stdio',
    limits: {
      startupTimeoutMs: 20000,
      lifetimeMs: 10000,
      stopGraceMs: 100,
      stopTimeoutMs: 5000,
      cleanupTimeoutMs: 1000,
      ioDrainTimeoutMs: 500,
      ioBufferBytes: 65536,
      outputBytes: 1048576
    }
  }
}
