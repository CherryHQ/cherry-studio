import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createRoot: vi.fn(),
  prepareWindow: vi.fn(async () => {}),
  render: vi.fn()
}))

vi.mock('@renderer/assets/styles/tailwind.css', () => ({}))

vi.mock('react-dom/client', () => ({
  createRoot: mocks.createRoot
}))

vi.mock('@renderer/windows/prepareWindow', () => ({
  prepareWindow: mocks.prepareWindow
}))

vi.mock('../SelectionToolbarApp', () => ({
  default: () => null
}))

// The toolbar reads these preferences on its first frame; prepareWindow must warm
// every one of them before createRoot runs or the first frame falls back to
// generated defaults (A2-style flash/mis-dispatch). Lock the list so a preference
// the toolbar reads cannot be dropped from the warm-up again.
const TOOLBAR_PRELOADED_PREFERENCES = [
  'app.language',
  'ui.custom_css',
  'ui.theme_mode',
  'ui.theme_user.color_primary',
  'feature.selection.compact',
  'feature.selection.action_items',
  'feature.selection.translate_only'
]

describe('selection toolbar entryPoint', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.createRoot.mockReturnValue({ render: mocks.render })
  })

  it('warms every preference the toolbar first frame reads, including translate_only', async () => {
    await import('../entryPoint')

    expect(mocks.prepareWindow).toHaveBeenCalledExactlyOnceWith({
      preference: TOOLBAR_PRELOADED_PREFERENCES
    })
  })

  it('renders only after the preference warm-up resolves', async () => {
    let resolveWarmUp!: () => void
    mocks.prepareWindow.mockImplementationOnce(() => new Promise<void>((resolve) => (resolveWarmUp = resolve)))

    let settled = false
    const pending = import('../entryPoint').then(() => {
      settled = true
    })

    await vi.waitFor(() => {
      expect(mocks.prepareWindow).toHaveBeenCalledTimes(1)
    })
    expect(settled).toBe(false)
    expect(mocks.createRoot).not.toHaveBeenCalled()

    resolveWarmUp()
    await pending

    expect(mocks.createRoot).toHaveBeenCalledTimes(1)
    expect(mocks.render).toHaveBeenCalledTimes(1)
    expect(settled).toBe(true)
  })
})
