import { type QuickPanelContextType, QuickPanelProvider, useQuickPanel } from '@renderer/components/QuickPanel'
import { act, render, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ComposerToolRuntimeProvider, useComposerToolLauncherController } from '../ComposerToolRuntime'
import type { ComposerToolLauncher } from '../toolLauncher'

const QuickPanelProbe = ({ onChange }: { onChange: (quickPanel: QuickPanelContextType) => void }) => {
  const quickPanel = useQuickPanel()

  useEffect(() => {
    onChange(quickPanel)
  }, [onChange, quickPanel])

  return null
}

const LauncherControllerProbe = ({
  onRender,
  onReady
}: {
  onRender: () => void
  onReady: (dispatchLauncher: ReturnType<typeof useComposerToolLauncherController>['dispatchLauncher']) => void
}) => {
  const { dispatchLauncher } = useComposerToolLauncherController()
  onRender()

  useEffect(() => {
    onReady(dispatchLauncher)
  }, [dispatchLauncher, onReady])

  return null
}

describe('useComposerToolLauncherController', () => {
  it('reads the latest QuickPanel snapshot without rerendering on panel updates', async () => {
    const onRender = vi.fn()
    const onClose = vi.fn()
    let quickPanel: QuickPanelContextType | undefined
    let dispatchLauncher: ReturnType<typeof useComposerToolLauncherController>['dispatchLauncher'] | undefined

    render(
      <QuickPanelProvider>
        <ComposerToolRuntimeProvider actions={{ addNewTopic: vi.fn(), onTextChange: vi.fn() }}>
          <QuickPanelProbe onChange={(value) => (quickPanel = value)} />
          <LauncherControllerProbe onRender={onRender} onReady={(value) => (dispatchLauncher = value)} />
        </ComposerToolRuntimeProvider>
      </QuickPanelProvider>
    )

    await waitFor(() => {
      expect(quickPanel).toBeDefined()
      expect(dispatchLauncher).toBeDefined()
    })
    expect(onRender).toHaveBeenCalledTimes(1)

    act(() => {
      quickPanel?.open({
        symbol: '/',
        list: [{ id: 'initial', label: 'Initial', icon: 'initial' }],
        onClose
      })
    })

    await waitFor(() => expect(quickPanel?.list.map((item) => item.id)).toEqual(['initial']))

    act(() => {
      quickPanel?.updateList([{ id: 'latest', label: 'Latest', icon: 'latest' }])
    })

    await waitFor(() => expect(quickPanel?.list.map((item) => item.id)).toEqual(['latest']))

    act(() => {
      quickPanel?.updateItemSelection(quickPanel.list[0], true)
    })

    await waitFor(() => expect(quickPanel?.list[0].isSelected).toBe(true))
    expect(onRender).toHaveBeenCalledTimes(1)

    const action = vi.fn(({ quickPanel: latestQuickPanel }: { quickPanel: QuickPanelContextType }) => {
      latestQuickPanel.close('click')
    })
    const launcher: ComposerToolLauncher = {
      id: 'latest-snapshot',
      kind: 'command',
      label: 'Latest snapshot',
      icon: 'latest',
      action
    }

    act(() => {
      dispatchLauncher?.(launcher, { source: 'popover' })
    })

    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({
        quickPanel: expect.objectContaining({
          list: [expect.objectContaining({ id: 'latest', isSelected: true })]
        })
      })
    )
    expect(onClose).toHaveBeenCalledWith(expect.objectContaining({ action: 'click' }))
    expect(onRender).toHaveBeenCalledTimes(1)
  })
})
