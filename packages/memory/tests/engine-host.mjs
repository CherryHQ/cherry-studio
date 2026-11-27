import { createMemoryEngine } from '../dist/index.mjs'
import { fixture } from './host.mjs'
export function states() {
  const data = new Map()
  return {
    async update(key, fn) {
      const { state, value } = fn(data.has(key) ? JSON.parse(data.get(key)) : undefined)
      data.set(key, JSON.stringify(state))
      return value
    }
  }
}
export function engineHost() {
  const base = fixture()
  const access = { ...base.access, scope: 'shared', owner: 'assistant', conversationId: 'chat', kind: 'chat' }
  const ports = {
    scope: () => base,
    now: Date.now,
    organization: states(),
    context: states(),
    extraction: states(),
    conversations: {
      async window() {
        throw Error('Unexpected extraction')
      }
    },
    async model() {
      return {
        id: 'model',
        contextWindow: 32000,
        countTokens: () => 3,
        async generate() {
          return {
            finishReason: 'stop',
            text: JSON.stringify({ writes: [{ path: 'MEMORY.md', content: 'Organized.' }], deletes: [] })
          }
        }
      }
    }
  }
  const engine = createMemoryEngine(ports)
  return { ...base, access, ports, engine, session: engine.open(access) }
}
