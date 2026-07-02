import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ activeProfileId: 'default', legacyExists: false }))

vi.mock('@application', () => ({
  application: {
    getPath: vi.fn((key: string) =>
      key === 'app.userdata' ? '/userData' : '/userData/Profiles/work/.cherrystudio/.copilot_token'
    ),
    get: vi.fn((name: string) => (name === 'ProfileService' ? { getActiveProfileId: () => h.activeProfileId } : {}))
  }
}))

vi.mock('fs', () => ({ default: { existsSync: () => h.legacyExists }, existsSync: () => h.legacyExists }))

const { copilotService } = await import('../CopilotService')
const resolve = () => (copilotService as unknown as { getTokenFilePath: () => string }).getTokenFilePath()

describe('CopilotService token path isolation', () => {
  beforeEach(() => {
    h.activeProfileId = 'default'
    h.legacyExists = false
  })

  it('a non-default profile always uses its per-profile token file, never the app-level legacy path', () => {
    h.activeProfileId = 'work'
    h.legacyExists = true // legacy file present, but must be ignored for a non-default profile
    expect(resolve()).toBe('/userData/Profiles/work/.cherrystudio/.copilot_token')
  })

  it('the default profile adopts the legacy token when present (migration)', () => {
    h.activeProfileId = 'default'
    h.legacyExists = true
    expect(resolve()).toBe('/userData/.copilot_token')
  })

  it('re-resolves per access (no memoization) when the active profile changes', () => {
    h.activeProfileId = 'default'
    h.legacyExists = true
    expect(resolve()).toBe('/userData/.copilot_token')
    h.activeProfileId = 'work'
    expect(resolve()).toBe('/userData/Profiles/work/.cherrystudio/.copilot_token')
  })
})
