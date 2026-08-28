import type { MiniApp } from '@shared/data/types/miniApp'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WebviewTag } from 'electron'
import type { RefObject } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import MinimalToolbar from '../MinimalToolbar'

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    allApps: [],
    pinned: [],
    updateAppStatus: vi.fn()
  })
}))

vi.mock('@renderer/utils/platform', () => ({
  isDev: false
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

const customApp: MiniApp = {
  appId: 'custom-comfyui',
  presetMiniAppId: null,
  status: 'enabled',
  orderKey: 'a0',
  name: 'ComfyUI',
  url: 'http://localhost:8188'
}

afterEach(cleanup)

describe('MinimalToolbar restart action', () => {
  it('renders a separate restart action and invokes only its handler', async () => {
    const user = userEvent.setup()
    const onReload = vi.fn()
    const onRestart = vi.fn()
    const webviewRef: RefObject<WebviewTag | null> = { current: null }

    render(
      <MinimalToolbar
        app={customApp}
        webviewRef={webviewRef}
        currentUrl={customApp.url}
        onReload={onReload}
        onRestart={onRestart}
        onOpenDevTools={vi.fn()}
        splitMode="open"
        onSplit={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'miniApp.popup.restart' }))

    expect(onRestart).toHaveBeenCalledOnce()
    expect(onReload).not.toHaveBeenCalled()
  })
})
