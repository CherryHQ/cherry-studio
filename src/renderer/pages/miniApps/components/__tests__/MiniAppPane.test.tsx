import type { MiniApp } from '@shared/data/types/miniApp'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import MiniAppPane from '../MiniAppPane'

const webviewStateMocks = vi.hoisted(() => ({
  requestWebviewRecreate: vi.fn(),
  setWebviewLoaded: vi.fn()
}))

vi.mock('../MinimalToolbar', () => ({
  default: ({ onReload, onRestart }: { onReload: () => void; onRestart: () => void }) => (
    <>
      <button type="button" onClick={onReload}>
        refresh
      </button>
      <button type="button" onClick={onRestart}>
        restart
      </button>
    </>
  )
}))

vi.mock('../WebviewSearch', () => ({
  default: () => null
}))

vi.mock('@renderer/utils/webviewStateManager', () => ({
  getWebviewLoaded: () => false,
  onWebviewStateChange: () => () => {},
  requestWebviewRecreate: webviewStateMocks.requestWebviewRecreate,
  setWebviewLoaded: webviewStateMocks.setWebviewLoaded
}))

vi.mock('@renderer/components/icons/miniAppsLogo', () => ({
  getMiniAppsLogoRef: () => undefined,
  useMiniAppLogo: () => undefined
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('react-spinners/BeatLoader', () => ({
  default: () => <div data-testid="beat-loader" />
}))

const customApp: MiniApp = {
  appId: 'custom-chatgpt',
  kind: 'site',
  presetMiniAppId: null,
  status: 'enabled',
  orderKey: 'a0',
  name: 'ChatGPT',
  url: 'https://chat.openai.com',
  logoSrc: 'file:///files/chatgpt.webp'
}

afterEach(() => {
  cleanup()
  webviewStateMocks.requestWebviewRecreate.mockReset()
  webviewStateMocks.setWebviewLoaded.mockReset()
})

describe('MiniAppPane', () => {
  it('names the standalone loading logo with the mini-app identity', () => {
    render(<MiniAppPane app={customApp} splitMode="open" onSplit={vi.fn()} />)

    expect(screen.getByRole('img', { name: 'ChatGPT' })).toHaveAttribute('src', 'file:///files/chatgpt.webp')
  })

  it('requests a full recreation even while the WebView is not ready or attached', async () => {
    const user = userEvent.setup()
    render(<MiniAppPane app={customApp} splitMode="open" onSplit={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'restart' }))

    expect(webviewStateMocks.requestWebviewRecreate).toHaveBeenCalledWith('custom-chatgpt')
    expect(webviewStateMocks.setWebviewLoaded).not.toHaveBeenCalled()
  })
})
