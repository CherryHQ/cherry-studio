import type { MiniApp } from '@shared/data/types/miniApp'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import MiniAppPane from '../MiniAppPane'

vi.mock('../MinimalToolbar', () => ({
  default: () => <div data-testid="minimal-toolbar" />
}))

vi.mock('../WebviewSearch', () => ({
  default: () => null
}))

vi.mock('@renderer/utils/webviewStateManager', () => ({
  getWebviewLoaded: () => false,
  onWebviewStateChange: () => () => {},
  setWebviewLoaded: vi.fn()
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
})

describe('MiniAppPane loading logo', () => {
  it('names the standalone loading logo with the mini-app identity', () => {
    render(<MiniAppPane app={customApp} splitMode="open" onSplit={vi.fn()} isHostActive />)

    expect(screen.getByRole('img', { name: 'ChatGPT' })).toHaveAttribute('src', 'file:///files/chatgpt.webp')
  })
})
