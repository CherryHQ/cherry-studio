import { MockApplicationUtils } from '@test-mocks/main/application'
import { type BrowserWindow, screen } from 'electron'
import { afterEach, assert, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

// @application, electron, and @logger are globally mocked in tests/main.setup.ts.
import { application } from '@application'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { WindowType } from '@main/core/window/types'
import type { WindowManager } from '@main/core/window/WindowManager'
import type { SelectionAction } from '@shared/types/selection'

const { getApplicationIdMock } = vi.hoisted(() => ({
  getApplicationIdMock: vi.fn(() => 'com.kangfenmao.CherryStudio')
}))

vi.mock('@main/utils/appEdition', () => ({
  getApplicationId: getApplicationIdMock
}))

vi.mock('@main/core/platform', () => ({
  isDev: false,
  isLinux: false,
  isMac: true,
  isWin: false
}))

const { SelectionService } = await import('../SelectionService')

// Reach the protected onAllReady/activate without widening the public surface.
type TestableSelectionService = InstanceType<typeof SelectionService> & {
  onAllReady: InstanceType<typeof SelectionService>['onAllReady']
  activate: InstanceType<typeof SelectionService>['activate']
  deactivate: InstanceType<typeof SelectionService>['deactivate']
}

/** Drain the setImmediate queue so the deferred warm-up runs. */
const flushImmediate = () => new Promise((resolve) => setImmediate(resolve))

beforeEach(() => {
  Object.assign(screen, {
    getDisplayNearestPoint: vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1280, height: 800 }
    }))
  })
})

describe('SelectionService.onAllReady — deferred warm-up', () => {
  let svc: TestableSelectionService
  let prefGet: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    BaseService.resetInstances()
    svc = new SelectionService() as TestableSelectionService
    prefGet = vi.spyOn(application.get('PreferenceService'), 'get')
  })

  afterEach(() => {
    BaseService.resetInstances()
    vi.restoreAllMocks()
  })

  /**
   * Wire activate/deactivate to a local flag and expose it through the `isActivated` getter the
   * reconciler reads, so a successful apply actually converges the snapshot (no spin loop). Returns
   * the activate spy.
   */
  const wireActivation = () => {
    let activated = false
    const activate = vi.spyOn(svc, 'activate').mockImplementation(async () => {
      activated = true
      return true
    })
    vi.spyOn(svc, 'deactivate').mockImplementation(async () => {
      activated = false
      return true
    })
    vi.spyOn(svc, 'isActivated', 'get').mockImplementation(() => activated)
    return activate
  }

  /** Fetch the `feature.selection.enabled` change handler that onInit() subscribed. */
  const getEnabledChangeHandler = () => {
    const subscribeChange = vi.mocked(application.get('PreferenceService').subscribeChange<'feature.selection.enabled'>)
    // Generic mock history spans every key; select the enabled subscription before invoking its typed callback.
    const handler = subscribeChange.mock.calls.find(([key]) => key === 'feature.selection.enabled')?.[1]
    assert.isDefined(handler, 'Expected the selection enabled subscription')
    return handler
  }

  it('skips activation entirely when the feature is disabled', async () => {
    prefGet.mockReturnValue(false)
    const activate = wireActivation()

    svc.onAllReady()
    await flushImmediate()

    expect(activate).not.toHaveBeenCalled()
  })

  it('stays deactivated when the feature is disabled before the deferred warm-up applies', async () => {
    // Enabled at onAllReady time, so the warm-up is scheduled.
    prefGet.mockImplementation((key) => key === 'feature.selection.enabled')
    const activate = wireActivation()

    await svc._doInit() // registers the `feature.selection.enabled` subscription
    const enabledHandler = getEnabledChangeHandler()

    svc.onAllReady() // enabled → schedules the deferred warm-up

    // The user disables before the deferred warm-up fires. The old code activated unconditionally
    // from the setImmediate; the reconciler re-reads the desired state and never activates.
    enabledHandler(false)

    await flushImmediate()

    expect(activate).not.toHaveBeenCalled()
    expect(svc.isActivated).toBe(false)
  })

  it('suspends the SelectionAction pool when disabled before the deferred warm-up activates', async () => {
    // Disable before the warm-up ever activated: the reconciler settles without deactivate(),
    // so only the subscription's direct suspend stops the eager warmup.
    prefGet.mockImplementation((key) => key === 'feature.selection.enabled')
    const activate = wireActivation()
    const suspendPool = vi.mocked(application.get('WindowManager').suspendPool)

    await svc._doInit()
    expect(suspendPool).not.toHaveBeenCalled()

    svc.onAllReady()
    getEnabledChangeHandler()(false)

    await flushImmediate()

    expect(activate).not.toHaveBeenCalled()
    expect(suspendPool).toHaveBeenCalledWith(WindowType.SelectionAction)
  })

  it('resumes the pool after a rapid disable→enable on an already-active service', async () => {
    // false→true with no yield in between: the reconciler settles without re-running
    // onActivate(), so only the subscription's direct resume undoes the direct suspend.
    prefGet.mockImplementation((key) => key === 'feature.selection.enabled')
    const activate = wireActivation()
    const wm = vi.mocked(application.get('WindowManager'))

    await svc._doInit()
    svc.onAllReady()
    await flushImmediate() // deferred warm-up activates the service
    expect(svc.isActivated).toBe(true)

    const enabledHandler = getEnabledChangeHandler()
    enabledHandler(false)
    expect(wm.suspendPool).toHaveBeenCalledWith(WindowType.SelectionAction)
    enabledHandler(true)
    expect(wm.resumePool).toHaveBeenCalledWith(WindowType.SelectionAction)

    await flushImmediate()

    // No deactivate/activate cycle ran — the subscription itself restored the pool.
    expect(activate).toHaveBeenCalledTimes(1)
    expect(svc.isActivated).toBe(true)
  })
})

describe('SelectionService.onInit — SelectionAction pool suspension', () => {
  let svc: TestableSelectionService
  let prefGet: ReturnType<typeof vi.spyOn>
  let suspendPool: Mock<WindowManager['suspendPool']>

  beforeEach(() => {
    vi.clearAllMocks()
    BaseService.resetInstances()
    svc = new SelectionService() as TestableSelectionService
    prefGet = vi.spyOn(application.get('PreferenceService'), 'get')
    suspendPool = vi.mocked(application.get('WindowManager').suspendPool)
  })

  afterEach(() => {
    BaseService.resetInstances()
    vi.restoreAllMocks()
  })

  it('suspends both selection window pools when the feature is disabled at boot', async () => {
    // Without the onInit suspend, the eager warmup would pre-create a standby renderer.
    prefGet.mockReturnValue(false)

    await svc._doInit()

    expect(suspendPool).toHaveBeenCalledWith(WindowType.SelectionAction)
    expect(suspendPool).toHaveBeenCalledWith(WindowType.SelectionAgent)
  })
})

describe('SelectionService toolbar sizing contract', () => {
  let svc: InstanceType<typeof SelectionService>
  let prefGet: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    BaseService.resetInstances()
    svc = new SelectionService()
    prefGet = vi.spyOn(application.get('PreferenceService'), 'get')
  })

  afterEach(async () => {
    await svc._doDestroy()
    BaseService.resetInstances()
    vi.restoreAllMocks()
  })

  const createToolbarHarness = async (widthCss: number, preferenceZoom: number, actualZoom: number) => {
    prefGet.mockImplementation((key) => (key === 'app.zoom_factor' ? preferenceZoom : false))
    await svc._doInit()
    const toolbarWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: {
        isDestroyed: vi.fn(() => false),
        getZoomFactor: vi.fn(() => actualZoom)
      },
      setBounds: vi.fn(),
      setPosition: vi.fn(),
      setFocusable: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      showInactive: vi.fn()
    }
    // SAFETY: The geometry fixture implements the toolbar operations consumed here; Electron cannot run in this Node suite.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Keep the partial native window at its fixture boundary.
    svc['toolbarWindow'] = toolbarWindow as unknown as BrowserWindow
    svc.determineToolbarSize(widthCss, 43)
    const show = () => svc['showToolbarAtPosition']({ x: 1278, y: 300 }, 'bottomMiddle', 'com.kangfenmao.CherryStudio')

    return { toolbarWindow, show }
  }

  it('fits actual zoom 1.5 when the preference is 1', async () => {
    const { toolbarWindow, show } = await createToolbarHarness(350, 1, 1.5)

    show()

    expect(toolbarWindow.setBounds).toHaveBeenLastCalledWith({ x: 755, y: 300, width: 525, height: 65 })
    expect(toolbarWindow.setPosition).toHaveBeenLastCalledWith(755, 300, false)
  })

  it('rounds fractional dimensions up and keeps the right edge within the work area', async () => {
    const { toolbarWindow, show } = await createToolbarHarness(351, 1.1, 1.1)

    show()

    expect.soft(toolbarWindow.setBounds).toHaveBeenLastCalledWith({ x: 893, y: 300, width: 387, height: 48 })
    const bounds = toolbarWindow.setBounds.mock.lastCall![0]
    expect(bounds.x + bounds.width).toBe(1280)
    expect(toolbarWindow.setPosition).toHaveBeenLastCalledWith(893, 300, false)
  })

  it('fits actual zoom 1 when the preference is 1.5', async () => {
    const { toolbarWindow, show } = await createToolbarHarness(350, 1.5, 1)

    show()

    expect(toolbarWindow.setBounds).toHaveBeenLastCalledWith({ x: 930, y: 300, width: 350, height: 43 })
    expect(toolbarWindow.setPosition).toHaveBeenLastCalledWith(930, 300, false)
  })

  it('reads the new actual zoom on the next show without another size report', async () => {
    const { toolbarWindow, show } = await createToolbarHarness(350, 1, 1)

    show()
    expect(toolbarWindow.setBounds).toHaveBeenLastCalledWith({ x: 930, y: 300, width: 350, height: 43 })

    toolbarWindow.webContents.getZoomFactor.mockReturnValue(1.5)
    show()

    expect(toolbarWindow.setBounds).toHaveBeenLastCalledWith({ x: 755, y: 300, width: 525, height: 65 })
    expect(toolbarWindow.setPosition).toHaveBeenLastCalledWith(755, 300, false)
  })

  it('anchors an exact-fit toolbar at the work-area left edge', async () => {
    const { toolbarWindow, show } = await createToolbarHarness(1280, 1, 1)

    show()

    expect(toolbarWindow.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 300, width: 1280, height: 43 })
    const bounds = toolbarWindow.setBounds.mock.lastCall![0]
    expect(bounds.x + bounds.width).toBe(1280)
    expect(toolbarWindow.setPosition).toHaveBeenLastCalledWith(0, 300, false)
  })
})

describe('SelectionService macOS toolbar', () => {
  const createToolbarHarness = () => {
    const svc = new SelectionService()
    const toolbarWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: {
        isDestroyed: vi.fn(() => false),
        getZoomFactor: vi.fn(() => 1)
      },
      setBounds: vi.fn(),
      setFocusable: vi.fn(),
      setPosition: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      showInactive: vi.fn()
    }
    // SAFETY: The fixture supplies native toolbar operations; sizing and positioning run through the real service.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Electron windows are unavailable in the Node runner.
    svc['toolbarWindow'] = toolbarWindow as unknown as BrowserWindow

    return { show: svc['showToolbarAtPosition'].bind(svc), toolbarWindow }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    BaseService.resetInstances()
  })

  afterEach(() => {
    BaseService.resetInstances()
    vi.restoreAllMocks()
  })

  it.each([
    ['global', 'com.kangfenmao.CherryStudio'],
    ['China', 'com.cherryai.cherrystudio.cn']
  ])('preserves selection inside the %s edition', (_edition, applicationId) => {
    getApplicationIdMock.mockReturnValue(applicationId)
    const { show, toolbarWindow } = createToolbarHarness()

    show({ x: 10, y: 20 }, 'bottomLeft', applicationId)

    expect(toolbarWindow.setVisibleOnAllWorkspaces).not.toHaveBeenCalled()
    expect(toolbarWindow.showInactive).toHaveBeenCalledOnce()
  })

  it('treats the other edition as an external app', () => {
    getApplicationIdMock.mockReturnValue('com.kangfenmao.CherryStudio')
    const { show, toolbarWindow } = createToolbarHarness()

    show({ x: 10, y: 20 }, 'bottomLeft', 'com.cherryai.cherrystudio.cn')

    expect(toolbarWindow.setFocusable).toHaveBeenCalledWith(false)
    expect(toolbarWindow.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true
    })
    expect(toolbarWindow.showInactive).toHaveBeenCalledOnce()
  })
})

describe('SelectionService.processAction — agent routing', () => {
  const openAgentWindow = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    BaseService.resetInstances()
    MockApplicationUtils.setService('SelectionAgentWindowService', { open: openAgentWindow })
  })

  afterEach(() => {
    MockApplicationUtils.resetServices()
    BaseService.resetInstances()
  })

  it.each<SelectionAction>([
    { id: 'ask-agent', name: 'Ask Agent', enabled: true, isBuiltIn: true },
    { id: 'user-1', name: 'Research', enabled: true, isBuiltIn: false, runner: 'agent' }
  ])('opens $id in the agent window instead of the action window', (action) => {
    new SelectionService().processAction(action, true)

    expect(openAgentWindow).toHaveBeenCalledWith(action, { anchor: null, isFullScreen: true })
    expect(application.get('WindowManager').open).not.toHaveBeenCalled()
  })

  it('keeps assistant-bound custom actions in the action window', () => {
    const action: SelectionAction = {
      id: 'user-2',
      name: 'Polish',
      enabled: true,
      isBuiltIn: false,
      runner: 'assistant'
    }

    new SelectionService().processAction(action)

    expect(openAgentWindow).not.toHaveBeenCalled()
    expect(application.get('WindowManager').open).toHaveBeenCalledWith(WindowType.SelectionAction, expect.anything())
  })
})

describe('SelectionService macOS action window', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    BaseService.resetInstances()
    Object.assign(screen, {
      getDisplayNearestPoint: vi.fn(() => ({
        workArea: { x: 0, y: 0, width: 1440, height: 900 }
      })),
      getCursorScreenPoint: vi.fn(() => ({ x: 500, y: 400 }))
    })
  })

  afterEach(() => {
    BaseService.resetInstances()
    vi.restoreAllMocks()
  })

  it.each([false, true])(
    'moves a recycled panel before showing it and restores flags (fullscreen=%s)',
    (fullScreen) => {
      vi.useFakeTimers()
      try {
        let activeSpace = 'invoking-space'
        let panelSpace = 'previous-space'
        let visible = false
        const handle = Buffer.alloc(8)
        const svc = new SelectionService()
        const nativePanel: NonNullable<InstanceType<typeof SelectionService>['nativePanel']> = {
          configurePanel: vi.fn(),
          moveToActiveSpace: vi.fn((actualHandle: Buffer) => {
            expect(actualHandle).toBe(handle)
            panelSpace = activeSpace
          })
        }
        svc['nativePanel'] = nativePanel
        const show = () => {
          activeSpace = panelSpace
          visible = true
        }
        const actionWindow = {
          getNativeWindowHandle: () => handle,
          setPosition: vi.fn(),
          setBounds: vi.fn(),
          setFocusable: vi.fn(),
          alwaysOnTop: false,
          isAlwaysOnTop: () => actionWindow.alwaysOnTop,
          setAlwaysOnTop: vi.fn((value: boolean) => {
            actionWindow.alwaysOnTop = value
          }),
          show: vi.fn(show),
          showInactive: vi.fn(show),
          isDestroyed: () => false,
          focus: vi.fn()
        }

        // SAFETY: This fixture records the native show/focus operations exercised by the panel sequence.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Electron windows are unavailable in the Node runner.
        svc['showActionWindow'](actionWindow as unknown as BrowserWindow, fullScreen)

        expect(actionWindow.setAlwaysOnTop.mock.calls).toEqual(fullScreen ? [[true]] : [[true], [false]])
        const moveToActiveSpace = vi.mocked(nativePanel.moveToActiveSpace)
        expect(actionWindow.setAlwaysOnTop.mock.invocationCallOrder[0]).toBeLessThan(
          moveToActiveSpace.mock.invocationCallOrder[0]
        )
        const showWindow = fullScreen ? actionWindow.showInactive : actionWindow.show
        expect(moveToActiveSpace.mock.invocationCallOrder[0]).toBeLessThan(showWindow.mock.invocationCallOrder[0])
        if (!fullScreen) {
          expect(showWindow.mock.invocationCallOrder[0]).toBeLessThan(
            actionWindow.setAlwaysOnTop.mock.invocationCallOrder[1]
          )
          expect(actionWindow.isAlwaysOnTop()).toBe(false)
        }
        expect(fullScreen ? actionWindow.show : actionWindow.showInactive).not.toHaveBeenCalled()
        expect(actionWindow.setFocusable.mock.calls).toEqual(fullScreen ? [[false]] : [])
        expect(actionWindow.focus).not.toHaveBeenCalled()
        vi.advanceTimersByTime(49)
        expect(actionWindow.setAlwaysOnTop.mock.calls).toEqual(fullScreen ? [[true]] : [[true], [false]])
        vi.runAllTimers()

        expect(actionWindow.setAlwaysOnTop.mock.calls).toEqual([[true], [false]])
        expect(actionWindow.isAlwaysOnTop()).toBe(false)
        expect(actionWindow.setFocusable.mock.calls).toEqual(fullScreen ? [[false], [true]] : [])
        expect(actionWindow.focus).toHaveBeenCalledTimes(fullScreen ? 1 : 0)
        expect(visible).toBe(true)
        expect(activeSpace).toBe('invoking-space')
        expect(panelSpace).toBe('invoking-space')
      } finally {
        vi.useRealTimers()
      }
    }
  )
})
