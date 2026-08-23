import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prepareWindow: vi.fn(),
  render: vi.fn()
}))

vi.mock('@renderer/windows/prepareWindow', () => ({
  prepareWindow: (...args: unknown[]) => mocks.prepareWindow(...args)
}))

vi.mock('react-dom/client', () => ({
  createRoot: () => ({ render: (...args: unknown[]) => mocks.render(...args) })
}))

describe('Conversation Island entry point', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.prepareWindow.mockResolvedValue(undefined)
    document.body.innerHTML = '<div id="root"></div>'
  })

  it('warms every first-frame preference before rendering', async () => {
    await import('../entryPoint')

    expect(mocks.prepareWindow).toHaveBeenCalledWith({
      preference: [
        'app.language',
        'ui.custom_css',
        'ui.theme_mode',
        'ui.theme_user.color_primary',
        'ui.theme_user.font_family',
        'ui.theme_user.code_font_family'
      ]
    })
    expect(mocks.prepareWindow.mock.invocationCallOrder[0]).toBeLessThan(mocks.render.mock.invocationCallOrder[0])
  })
})
