import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import MemoryServer from '../memory'
import { callBuiltinTool, toolText } from './builtinMcpClient'

describe('memory MCP server', () => {
  let tempDir: string
  let memory: MemoryServer

  const call = (name: string, args: Record<string, unknown> = {}) =>
    callBuiltinTool(() => memory.createServer(), name, args)

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cherry-memory-mcp-'))
    memory = new MemoryServer(path.join(tempDir, 'memory.json'))
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
  })

  it('reports an unknown entity as a tool error without changing the graph', async () => {
    const result = await call('add_observations', { observations: [{ entityName: 'Missing', contents: ['x'] }] })

    expect(result.isError).toBe(true)
    expect(toolText(result)).toContain('Entity with name Missing not found')
    expect(JSON.parse(toolText(await call('read_graph'))).entities).toEqual([])
  })

  it('rejects arguments that do not match the advertised schema', async () => {
    const missing = await call('create_entities', {})
    const wrongShape = await call('delete_entities', { entityNames: 'Cherry' })

    expect(missing.isError).toBe(true)
    expect(wrongShape.isError).toBe(true)
  })
})
