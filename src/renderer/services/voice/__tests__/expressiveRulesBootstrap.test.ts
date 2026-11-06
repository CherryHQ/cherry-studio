import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  subscribeChange: vi.fn(),
  request: vi.fn(),
  on: vi.fn(),
  setEnabled: vi.fn(),
  setRules: vi.fn()
}))

vi.mock('@renderer/data/PreferenceService', () => ({
  preferenceService: { get: mocks.get, subscribeChange: mocks.subscribeChange }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.request, on: mocks.on }
}))

vi.mock('../expressiveText', () => ({
  setExpressiveEnabled: mocks.setEnabled,
  setCustomExpressiveRules: mocks.setRules
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.subscribeChange.mockReturnValue(vi.fn())
  mocks.on.mockReturnValue(vi.fn())
})

describe('ensureExpressiveRulesLoaded', () => {
  it('keeps a preference change that lands while the initial read is pending', async () => {
    const initial = Promise.withResolvers<boolean>()
    const changed = Promise.withResolvers<boolean>()
    mocks.get.mockReturnValueOnce(initial.promise).mockReturnValueOnce(changed.promise)

    let onPreferenceChange: (() => void) | undefined
    mocks.subscribeChange.mockReturnValue((callback: () => void) => {
      onPreferenceChange = callback
      return vi.fn()
    })
    mocks.request.mockResolvedValue([])

    const { ensureExpressiveRulesLoaded } = await import('../expressiveRulesBootstrap')
    const loading = ensureExpressiveRulesLoaded()

    await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1))
    onPreferenceChange?.()
    changed.resolve(false)
    await vi.waitFor(() => expect(mocks.setEnabled).toHaveBeenCalledWith(false))

    // The initial read started before the change and must not win afterwards.
    initial.resolve(true)
    await loading

    expect(mocks.setEnabled).not.toHaveBeenCalledWith(true)
    expect(mocks.setEnabled).toHaveBeenLastCalledWith(false)
  })

  it('keeps a rules broadcast that lands while the initial list is pending', async () => {
    const initial = Promise.withResolvers<unknown[]>()
    mocks.get.mockResolvedValue(true)
    mocks.request.mockReturnValueOnce(initial.promise)

    const fresh = [{ kind: 'emoji', match: '🫥', zh: '躲藏', en: 'hiding' }]
    const stale = [{ kind: 'emoji', match: '😄', zh: '开心', en: 'happy' }]

    let onRulesChanged: ((rules: unknown) => void) | undefined
    mocks.on.mockImplementation((_event: string, callback: (rules: unknown) => void) => {
      onRulesChanged = callback
      return vi.fn()
    })

    const { ensureExpressiveRulesLoaded } = await import('../expressiveRulesBootstrap')
    const loading = ensureExpressiveRulesLoaded()

    await vi.waitFor(() => expect(mocks.on).toHaveBeenCalled())
    onRulesChanged?.(fresh)
    initial.resolve(stale)
    await loading

    expect(mocks.setRules).toHaveBeenCalledTimes(1)
    expect(mocks.setRules).toHaveBeenCalledWith(fresh)
  })
})
