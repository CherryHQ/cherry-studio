import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  navbarPosition: 'top' as 'left' | 'top',
  dispatch: vi.fn(),
  setTimeoutTimer: vi.fn(),
  setUserTheme: vi.fn(),
  setWindowStyle: vi.fn(),
  setTopicPosition: vi.fn(),
  setTheme: vi.fn(),
  setUseSystemTitleBar: vi.fn(),
  t: vi.fn((key: string) => key)
}))

vi.mock('@renderer/components/CodeEditor', () => ({
  default: () => <div data-testid="code-editor" />
}))

vi.mock('@renderer/components/Icons', () => ({
  ResetIcon: () => <span data-testid="reset-icon" />
}))

vi.mock('@renderer/components/Layout', () => ({
  HStack: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/components/TextBadge', () => ({
  default: ({ text }: { text: string }) => <span>{text}</span>
}))

vi.mock('@renderer/config/constant', () => ({
  isLinux: false,
  isMac: false,
  THEME_COLOR_PRESETS: ['#1677ff']
}))

vi.mock('@renderer/config/sidebar', () => ({
  DEFAULT_SIDEBAR_ICONS: ['assistants', 'agents', 'store']
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light', settedTheme: 'light' })
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useNavbarPosition: () => ({
    navbarPosition: mocks.navbarPosition,
    setNavbarPosition: vi.fn()
  }),
  useSettings: () => ({
    windowStyle: 'opaque',
    setWindowStyle: mocks.setWindowStyle,
    topicPosition: 'right',
    setTopicPosition: mocks.setTopicPosition,
    clickAssistantToShowTopic: false,
    showTopicTime: true,
    pinTopicsToTop: false,
    customCss: '',
    sidebarIcons: {
      visible: ['assistants', 'agents', 'store'],
      disabled: []
    },
    setTheme: mocks.setTheme,
    assistantIconType: 'model',
    userTheme: {
      colorPrimary: '#1677ff',
      userFontFamily: '',
      userCodeFontFamily: ''
    },
    useSystemTitleBar: false,
    setUseSystemTitleBar: mocks.setUseSystemTitleBar
  })
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: mocks.setTimeoutTimer })
}))

vi.mock('@renderer/hooks/useUserTheme', () => ({
  default: () => ({ setUserTheme: mocks.setUserTheme })
}))

vi.mock('@renderer/store', () => ({
  useAppDispatch: () => mocks.dispatch
}))

vi.mock('@renderer/store/settings', () => ({
  setAssistantIconType: (payload: unknown) => ({ type: 'setAssistantIconType', payload }),
  setClickAssistantToShowTopic: (payload: unknown) => ({ type: 'setClickAssistantToShowTopic', payload }),
  setCustomCss: (payload: unknown) => ({ type: 'setCustomCss', payload }),
  setPinTopicsToTop: (payload: unknown) => ({ type: 'setPinTopicsToTop', payload }),
  setShowTopicTime: (payload: unknown) => ({ type: 'setShowTopicTime', payload }),
  setSidebarIcons: (payload: unknown) => ({ type: 'setSidebarIcons', payload })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.t })
}))

vi.mock('antd', () => ({
  Button: ({ children, onClick }: any) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  ColorPicker: () => <div data-testid="color-picker" />,
  Divider: () => <div data-testid="divider" />,
  Segmented: () => <div data-testid="segmented" />,
  Select: () => <div data-testid="select" />,
  Switch: () => <input type="checkbox" readOnly />,
  Tooltip: ({ children }: any) => <>{children}</>
}))

vi.mock('antd/es/typography/Link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>
}))

vi.mock('../SidebarIconsManager', () => ({
  default: () => <div data-testid="sidebar-icons-manager" />
}))

import DisplaySettings from '../DisplaySettings'

describe('DisplaySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'api', {
      value: {
        getSystemFonts: vi.fn().mockResolvedValue([]),
        handleZoomFactor: vi.fn().mockResolvedValue(1),
        relaunchApp: vi.fn()
      },
      configurable: true
    })
  })

  it('shows the sidebar icon manager even when navbar position is top', async () => {
    mocks.navbarPosition = 'top'

    render(<DisplaySettings />)

    expect(await screen.findByTestId('sidebar-icons-manager')).toBeInTheDocument()
  })
})
