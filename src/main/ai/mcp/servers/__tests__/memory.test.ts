import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { BuiltinMcpEndpoint } from '../factory'
import { createMemoryEndpoint } from '../memory'
import { callBuiltinTool, toolText } from './builtinMcpClient'

describe('memory MCP server', () => {
  let tempDir: string
  let memory: BuiltinMcpEndpoint

  const call = (name: string, args: Record<string, unknown> = {}) =>
    callBuiltinTool(() => memory.createServer(), name, args)

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cherry-memory-mcp-'))
    memory = createMemoryEndpoint(path.join(tempDir, 'memory.json'))
    // Schema rejection can finish before initialization; settle its file I/O before teardown.
    await call('read_graph')
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('creates entities without observations and links them through relations', async () => {
    await call('create_entities', {
      entities: [
        { name: 'Cherry', entityType: 'application' },
        { name: 'Electron', entityType: 'framework' }
      ]
    })
    await call('create_relations', { relations: [{ from: 'Cherry', to: 'Electron', relationType: 'built_with' }] })

    const graph = JSON.parse(toolText(await call('open_nodes', { names: ['Cherry', 'Electron'] })))

    expect(graph.entities).toContainEqual({ name: 'Cherry', entityType: 'application', observations: [] })
    expect(graph.relations).toEqual([{ from: 'Cherry', to: 'Electron', relationType: 'built_with' }])
    expect(JSON.parse(toolText(await call('read_graph')))).toEqual(graph)
  })

  it('reports an unknown entity as a tool error without changing the graph', async () => {
    const result = await call('add_observations', { observations: [{ entityName: 'Missing', contents: ['x'] }] })

    expect(result.isError).toBe(true)
    expect(toolText(result)).toContain('Entity with name Missing not found')
    expect(JSON.parse(toolText(await call('read_graph'))).entities).toEqual([])
  })

  it.each([
    ['truncated JSON', '{"entities":[{"name":"Cherry","entityType":"app","observ'],
    ['a non-object', 'null'],
    ['entities that are not a list', '{"entities":{"Cherry":{}},"relations":[]}']
  ])('moves a memory file holding %s aside instead of overwriting it', async (_label, corrupt) => {
    const memoryPath = path.join(tempDir, 'corrupt', 'memory.json')
    await fs.mkdir(path.dirname(memoryPath))
    await fs.writeFile(memoryPath, corrupt)
    memory = createMemoryEndpoint(memoryPath)

    expect(JSON.parse(toolText(await call('read_graph')))).toEqual({ entities: [], relations: [] })

    const files = await fs.readdir(path.dirname(memoryPath))
    const backup = files.find((name) => name.startsWith('memory.json.corrupt-'))
    expect(backup).toBeDefined()
    expect(await fs.readFile(path.join(path.dirname(memoryPath), backup!), 'utf-8')).toBe(corrupt)

    await call('create_entities', { entities: [{ name: 'Electron', entityType: 'framework' }] })
    expect(JSON.parse(await fs.readFile(memoryPath, 'utf-8')).entities).toEqual([
      { name: 'Electron', entityType: 'framework', observations: [] }
    ])
  })

  it('reads a memory file whose entities lack observations and that has no relations', async () => {
    const memoryPath = path.join(tempDir, 'memory.json')
    await fs.writeFile(memoryPath, JSON.stringify({ entities: [{ name: 'Cherry', entityType: 'application' }] }))

    await call('create_entities', { entities: [{ name: 'Electron', entityType: 'framework' }] })
    await call('create_relations', { relations: [{ from: 'Cherry', to: 'Electron', relationType: 'built_with' }] })

    expect(JSON.parse(toolText(await call('read_graph')))).toEqual({
      entities: [
        { name: 'Cherry', entityType: 'application', observations: [] },
        { name: 'Electron', entityType: 'framework', observations: [] }
      ],
      relations: [{ from: 'Cherry', to: 'Electron', relationType: 'built_with' }]
    })
    expect(await fs.readdir(tempDir)).toEqual(['memory.json'])
  })

  it.skipIf(process.platform === 'win32')(
    'persists an entity when the call is retried after a failed write',
    async () => {
      const memoryPath = path.join(tempDir, 'locked', 'memory.json')
      memory = createMemoryEndpoint(memoryPath)
      await call('create_entities', { entities: [{ name: 'Electron', entityType: 'framework' }] })
      await fs.chmod(memoryPath, 0o400)
      await fs.chmod(path.dirname(memoryPath), 0o500)

      const failed = await call('create_entities', { entities: [{ name: 'Cherry', entityType: 'application' }] })
      await fs.chmod(path.dirname(memoryPath), 0o700)
      await fs.chmod(memoryPath, 0o600)
      expect(failed.isError).toBe(true)

      await call('create_entities', { entities: [{ name: 'Cherry', entityType: 'application' }] })
      expect(JSON.parse(await fs.readFile(memoryPath, 'utf-8')).entities).toEqual([
        { name: 'Electron', entityType: 'framework', observations: [] },
        { name: 'Cherry', entityType: 'application', observations: [] }
      ])
    }
  )

  it.skipIf(process.platform === 'win32')('writes through a symlinked memory path', async () => {
    const realPath = path.join(tempDir, 'synced', 'memory.json')
    const linkPath = path.join(tempDir, 'memory-link.json')
    await fs.mkdir(path.dirname(realPath))
    await fs.writeFile(realPath, JSON.stringify({ entities: [], relations: [] }))
    await fs.symlink(realPath, linkPath)
    memory = createMemoryEndpoint(linkPath)

    await call('create_entities', { entities: [{ name: 'Cherry', entityType: 'application' }] })

    expect((await fs.lstat(linkPath)).isSymbolicLink()).toBe(true)
    expect(JSON.parse(await fs.readFile(realPath, 'utf-8')).entities).toEqual([
      { name: 'Cherry', entityType: 'application', observations: [] }
    ])
  })

  it.skipIf(process.platform === 'win32')('keeps the permissions of an existing memory file', async () => {
    const memoryPath = path.join(tempDir, 'memory.json')
    await fs.writeFile(memoryPath, JSON.stringify({ entities: [], relations: [] }))
    await fs.chmod(memoryPath, 0o600)

    await call('create_entities', { entities: [{ name: 'Cherry', entityType: 'application' }] })

    expect((await fs.stat(memoryPath)).mode & 0o777).toBe(0o600)
  })

  it('leaves earlier entities untouched when add_observations fails on a later one', async () => {
    await call('create_entities', { entities: [{ name: 'Cherry', entityType: 'application' }] })

    const result = await call('add_observations', {
      observations: [
        { entityName: 'Cherry', contents: ['desktop app'] },
        { entityName: 'Missing', contents: ['x'] }
      ]
    })

    expect(result.isError).toBe(true)
    expect(JSON.parse(toolText(await call('read_graph'))).entities).toEqual([
      { name: 'Cherry', entityType: 'application', observations: [] }
    ])
  })

  it('rejects arguments that do not match the advertised schema', async () => {
    const missing = await call('create_entities', {})
    const wrongShape = await call('delete_entities', { entityNames: 'Cherry' })

    expect(missing.isError).toBe(true)
    expect(wrongShape.isError).toBe(true)
  })
})
