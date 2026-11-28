import { describe, expect, it } from 'vitest'

import { validateSpec } from '../../src/host/validateSpec.js'
import { spec } from '../fixtures.js'

describe('sandbox specification snapshot', () => {
  it('isolates validated permissions from caller mutations without freezing caller data', () => {
    const request = spec()
    const args = ['original']
    const env = { MODE: 'original' }
    const read = [request.command.cwd]
    const write = [request.command.cwd]
    const denyRead = [request.command.cwd]
    const denyWrite = [request.command.cwd]
    const mounts = [{ source: request.command.cwd, target: request.command.cwd, access: 'read' as const }]
    const targets = [{ host: 'example.com', port: 443 }]
    const snapshot = validateSpec({
      ...request,
      command: { ...request.command, args, env },
      filesystem: { read, write, denyRead, denyWrite },
      mounts,
      network: { mode: 'proxy', targets }
    })
    args[0] = 'changed'
    env.MODE = 'changed'
    for (const paths of [read, write, denyRead, denyWrite]) paths.length = 0
    mounts[0].source = request.command.executable
    targets[0].host = 'untrusted.example'
    request.limits.ioBufferBytes = 1

    expect(snapshot.command.args).toEqual(['original'])
    expect(snapshot.command.env.MODE).toBe('original')
    for (const paths of Object.values(snapshot.filesystem)) expect(paths).toEqual([request.command.cwd])
    expect(snapshot.mounts?.[0].source).toBe(request.command.cwd)
    expect(snapshot.network).toEqual({ mode: 'proxy', targets: [{ host: 'example.com', port: 443 }] })
    expect(snapshot.limits.ioBufferBytes).toBe(65536)
    expect(() => Object.assign(snapshot.command.env, { MODE: 'changed' })).toThrow(TypeError)
    const network = snapshot.network
    if (network.mode === 'proxy') expect(() => Object.assign(network.targets[0], { port: 80 })).toThrow(TypeError)
  })
})
