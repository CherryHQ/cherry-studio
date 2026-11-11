import { describe, expect, it } from 'vitest'

import { AgentBrowserRuntimeService } from '@renderer/services/AgentBrowserRuntimeService'

describe('browser runtime explicit navigation', () => {
  it('accepts repeated navigation only for an owned resource and retains it until consumed', () => {
    const runtime = new AgentBrowserRuntimeService('topic')
    const url = 'https://example.com/'
    expect(runtime.navigate('topic', url)).toBe(false)
    runtime.declare('topic', 'tab')
    runtime.ensure('topic', url)
    runtime.update('topic', { url: 'https://example.com/elsewhere' })
    expect(runtime.navigate('topic', url)).toBe(true)
    expect(runtime.get('topic')?.pendingNavigation?.url).toBe(url)
    expect(runtime.get('topic')?.guest).toBeNull()
  })
})
