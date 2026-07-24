import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ModelList from '../ModelList'

const pullButtonPropsSpy = vi.fn()
const detectModelsIfEmptyMock = vi.fn()
const invalidateAutoDetectionMock = vi.fn()
const addModelsMock = vi.fn()
const dismissDetectedModelsMock = vi.fn()
const openDetectedModelsMock = vi.fn()
const modelDetectionLeavePopupShowMock = vi.fn()
const unregisterTabLeaveGuardMock = vi.fn()
let registeredTabLeaveGuard: (() => boolean | Promise<boolean>) | undefined
const registerTabLeaveGuardMock = vi.fn((_tabId: string, guard: () => boolean | Promise<boolean>) => {
  registeredTabLeaveGuard = guard
  return unregisterTabLeaveGuardMock
})

const pullState = {
  value: {} as any
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (options?.count === undefined ? key : `${key}:${options.count}`)
  })
}))

vi.mock('@renderer/hooks/tab', () => ({
  useCurrentTabId: () => 'provider-settings-tab',
  useOptionalTabsContext: () => ({ registerTabLeaveGuard: registerTabLeaveGuardMock })
}))

vi.mock('../ModelDetectionLeavePopup', () => ({
  default: { show: (props: unknown) => modelDetectionLeavePopupShowMock(props) }
}))

vi.mock('@cherrystudio/ui', () => ({
  Alert: ({ action, description, message, type }: any) => (
    <div role="status" data-alert-type={type}>
      <span>{message}</span>
      <span>{description}</span>
      {action}
    </div>
  ),
  Button: ({ children, loading, ...props }: any) => (
    <button type="button" data-loading={loading ? 'true' : undefined} {...props}>
      {children}
    </button>
  ),
  ButtonGroup: ({ children }: any) => <div>{children}</div>
}))

vi.mock('../modelListHealthContext', () => ({
  useModelListHealthRun: () => ({ isHealthChecking: false })
}))

vi.mock('../ProviderModelList', () => ({
  default: ({ actions }: any) => <div>{actions?.({ disabled: false, hasVisibleModels: false })}</div>
}))

vi.mock('../ProviderModelPullReconcile', () => ({
  default: (props: any) => {
    pullButtonPropsSpy(props)
    return <button type="button">manual-pull</button>
  }
}))

vi.mock('../ProviderModelAdd', () => ({ default: () => null }))
vi.mock('../ProviderModelDownload', () => ({ default: () => null }))
vi.mock('../ProviderModelHealthCheck', () => ({ default: () => null }))

vi.mock('../useProviderModelPullReconcile', () => ({
  useProviderModelPullReconcile: () => pullState.value
}))

describe('ModelList connection model detection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registeredTabLeaveGuard = undefined
    modelDetectionLeavePopupShowMock.mockResolvedValue('stay')
    detectModelsIfEmptyMock.mockResolvedValue('detected')
    addModelsMock.mockResolvedValue(true)
    pullState.value = {
      addModels: addModelsMock,
      detectedModels: [],
      detectModelsIfEmpty: detectModelsIfEmptyMock,
      dismissDetectedModels: dismissDetectedModelsMock,
      invalidateAutoDetection: invalidateAutoDetectionMock,
      isApplyingPullReconcile: false,
      isAutoDetectingModels: false,
      localModels: [],
      openDetectedModels: openDetectedModelsMock
    }
  })

  it('does not detect models on a cold render with no connection-field event', () => {
    render(<ModelList providerId="openai" />)

    expect(detectModelsIfEmptyMock).not.toHaveBeenCalled()
    expect(registerTabLeaveGuardMock).not.toHaveBeenCalled()
  })

  it('detects models after a connection field loses focus while the local list is empty', async () => {
    render(<ModelList providerId="openai" connectionModelDetectionSignal={{ intent: 'detect', version: 1 }} />)

    await waitFor(() => expect(detectModelsIfEmptyMock).toHaveBeenCalledTimes(1))
  })

  it('invalidates instead of fetching and preserves the changed-field guide when models already exist', async () => {
    pullState.value.localModels = [{ id: 'openai::existing' }]
    render(
      <ModelList
        providerId="openai"
        connectionModelDetectionSignal={{ intent: 'detect', shouldGuideExistingModels: true, version: 1 }}
      />
    )

    await waitFor(() => expect(invalidateAutoDetectionMock).toHaveBeenCalledTimes(1))
    expect(detectModelsIfEmptyMock).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(pullButtonPropsSpy).toHaveBeenLastCalledWith(expect.objectContaining({ guideVersion: 1 }))
    )
  })

  it('does not show the pull guide for an unchanged field blur when models already exist', async () => {
    pullState.value.localModels = [{ id: 'openai::existing' }]
    render(<ModelList providerId="openai" connectionModelDetectionSignal={{ intent: 'detect', version: 1 }} />)

    await waitFor(() => expect(invalidateAutoDetectionMock).toHaveBeenCalledTimes(1))
    expect(detectModelsIfEmptyMock).not.toHaveBeenCalled()
    expect(pullButtonPropsSpy).toHaveBeenLastCalledWith(expect.objectContaining({ guideVersion: 0 }))
  })

  it('clears stale detection state on an invalidating connection change', async () => {
    render(<ModelList providerId="openai" connectionModelDetectionSignal={{ intent: 'invalidate', version: 1 }} />)

    await waitFor(() => expect(invalidateAutoDetectionMock).toHaveBeenCalledTimes(1))
    expect(detectModelsIfEmptyMock).not.toHaveBeenCalled()
  })

  it('invalidates an in-flight detection when a local model appears', async () => {
    pullState.value.isAutoDetectingModels = true
    const view = render(<ModelList providerId="openai" connectionModelDetectionSignal={null} />)

    pullState.value = {
      ...pullState.value,
      localModels: [{ id: 'openai::existing' }]
    }
    view.rerender(<ModelList providerId="openai" />)

    await waitFor(() => expect(invalidateAutoDetectionMock).toHaveBeenCalledTimes(1))
  })

  it('keeps the current tab open when the user wants to wait for in-flight detection', async () => {
    pullState.value.isAutoDetectingModels = true
    render(<ModelList providerId="openai" />)

    await waitFor(() =>
      expect(registerTabLeaveGuardMock).toHaveBeenCalledWith('provider-settings-tab', expect.any(Function))
    )
    await expect(registeredTabLeaveGuard?.()).resolves.toBe(false)

    expect(modelDetectionLeavePopupShowMock).toHaveBeenCalledWith({ count: 0, phase: 'detecting' })
    expect(invalidateAutoDetectionMock).not.toHaveBeenCalled()
  })

  it('discards detected models only after the user confirms leaving the tab', async () => {
    modelDetectionLeavePopupShowMock.mockResolvedValueOnce('leave')
    pullState.value.detectedModels = [{ id: 'openai::one' }, { id: 'openai::two' }]
    render(<ModelList providerId="openai" />)

    await waitFor(() => expect(registeredTabLeaveGuard).toBeTypeOf('function'))
    await expect(registeredTabLeaveGuard?.()).resolves.toBe(true)

    expect(modelDetectionLeavePopupShowMock).toHaveBeenCalledWith({ count: 2, phase: 'detected' })
    expect(invalidateAutoDetectionMock).toHaveBeenCalledTimes(1)
  })

  it('offers add-all, selective add, and dismissal for detected models', async () => {
    pullState.value.detectedModels = [{ id: 'openai::one' }, { id: 'openai::two' }]
    render(<ModelList providerId="openai" />)

    expect(screen.getByText('settings.models.auto_detect.message:2')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAttribute('data-alert-type', 'success')

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.auto_detect.select' }))
    expect(openDetectedModelsMock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.auto_detect.dismiss' }))
    expect(dismissDetectedModelsMock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.auto_detect.add_all' }))
    await waitFor(() => expect(addModelsMock).toHaveBeenCalledWith([{ id: 'openai::one' }, { id: 'openai::two' }]))
    expect(dismissDetectedModelsMock).toHaveBeenCalledTimes(2)
  })

  it('keeps the notice available when adding all models fails', async () => {
    addModelsMock.mockResolvedValueOnce(false)
    pullState.value.detectedModels = [{ id: 'openai::one' }]
    const view = render(<ModelList providerId="openai" />)

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.auto_detect.add_all' }))

    await waitFor(() => expect(addModelsMock).toHaveBeenCalled())
    pullState.value = {
      ...pullState.value,
      localModels: [{ id: 'openai::one' }]
    }
    view.rerender(<ModelList providerId="openai" />)

    expect(dismissDetectedModelsMock).not.toHaveBeenCalled()
    expect(invalidateAutoDetectionMock).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
