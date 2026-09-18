import { describe, expect, it } from 'vitest'

import { normalizeMainWindowRoute } from '../navigationRoute'

describe('normalizeMainWindowRoute', () => {
  it.each([
    ['/agents', '/app/agents'],
    ['/knowledge', '/app/knowledge'],
    ['/paintings', '/app/paintings'],
    ['/translate', '/app/translate'],
    ['/files', '/app/files'],
    ['/notes', '/app/notes'],
    ['/apps', '/app/mini-app'],
    ['/code', '/app/code'],
    ['/launchpad', '/app/launchpad']
  ])('maps the legacy route %s to %s', (legacyRoute, appRoute) => {
    expect(normalizeMainWindowRoute(legacyRoute)).toBe(appRoute)
  })

  it('preserves route suffixes', () => {
    expect(normalizeMainWindowRoute('/agents/session?intent=feedback#latest')).toBe(
      '/app/agents/session?intent=feedback#latest'
    )
  })

  it('leaves canonical and similarly prefixed routes unchanged', () => {
    expect(normalizeMainWindowRoute('/app/agents?intent=feedback')).toBe('/app/agents?intent=feedback')
    expect(normalizeMainWindowRoute('/agentship')).toBe('/agentship')
  })
})
