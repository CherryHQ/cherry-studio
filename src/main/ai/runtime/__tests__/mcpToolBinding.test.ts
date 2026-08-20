import { describe, expect, it } from 'vitest'

import {
  createMcpToolBinding,
  createMcpToolBindingSnapshot,
  McpToolBindingCollisionError,
  McpToolBindingStore
} from '../mcpToolBinding'

const serverWireName = 'mysql_a79b8498a1fb'

function binding(originalToolName: string, serverId = 'server-a') {
  return createMcpToolBinding({ serverId, serverWireName, originalToolName })
}

describe('McpToolBinding', () => {
  it('looks up runtime names and server-scoped wire names without parsing them', () => {
    const query = binding('query')
    const snapshot = createMcpToolBindingSnapshot([query], 3)

    expect(snapshot.version).toBe(3)
    expect(snapshot.lookupRuntimeName(query.runtimeName)).toEqual(query)
    expect(snapshot.lookupServerTool(query.serverWireName, query.toolWireName)).toEqual(query)
    expect(snapshot.lookupRuntimeName('mcp__mysql_a79b8498a1fb__query__not-real')).toBeUndefined()
    expect(snapshot.lookupServerTool('other-server', query.toolWireName)).toBeUndefined()
  })

  it('rejects duplicate complete runtime names before exposure', () => {
    const first = binding('query')
    const duplicate = { ...binding('other'), runtimeName: first.runtimeName }

    expect(() => createMcpToolBindingSnapshot([first, duplicate])).toThrow(McpToolBindingCollisionError)
  })

  it('starts cold, accepts newer refreshes, and rejects stale or disposed refreshes', () => {
    const store = new McpToolBindingStore()

    expect(store.getSnapshot().version).toBe(0)
    expect(store.getSnapshot().bindings).toHaveLength(0)
    expect(store.replaceSnapshotIfCurrent(2, [binding('query')])).toBe(true)
    expect(store.getSnapshot().version).toBe(2)
    expect(store.replaceSnapshotIfCurrent(1, [binding('other')])).toBe(false)
    expect(store.getSnapshot().lookupRuntimeName(binding('query').runtimeName)?.originalToolName).toBe('query')

    store.dispose()
    expect(store.replaceSnapshotIfCurrent(3, [binding('third')])).toBe(false)
    expect(store.getSnapshot().version).toBe(2)
  })
})
