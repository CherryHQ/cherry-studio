import type { NormalToolResponse } from '@renderer/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { type ReactNode, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ToolBlockGroup from '../../Blocks/ToolBlockGroup'
import { MessageAgentTools } from '../MessageAgentTools'
import MessageMcpTool from '../MessageMcpTool'
import ToolPermissionRequestCard from '../ToolPermissionRequestCard'

const mockUseAppSelector = vi.fn()
const mockUseToolApproval = vi.fn()
const mockUseAgentToolApproval = vi.fn()

let currentPendingPermission: Record<string, unknown> | null = null

vi.mock('@renderer/store', () => ({
  useAppSelector: (selector: (state: { toolPermissions: { requests: Record<string, unknown> } }) => unknown) =>
    mockUseAppSelector(selector),
  useAppDispatch: () => vi.fn()
}))

vi.mock('@renderer/store/toolPermissions', () => ({
  selectPendingPermission: vi.fn(() => currentPendingPermission),
  toolPermissionsActions: {
    submissionSent: vi.fn(),
    submissionFailed: vi.fn()
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown> | string) => {
      if (key === 'message.tools.groupHeader' && typeof options === 'object') {
        return `${options.count as number} tool calls`
      }
      if (typeof options === 'string') {
        return options
      }
      return key
    }
  }),
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  }
}))

vi.mock('antd', () => {
  const normalizeKeys = (keys?: string | string[]) => {
    if (Array.isArray(keys)) {
      return keys.map(String)
    }
    return keys ? [String(keys)] : []
  }

  const Collapse = ({
    items = [],
    className = '',
    activeKey,
    defaultActiveKey,
    ghost,
    expandIcon,
    onChange
  }: {
    items?: Array<Record<string, any>>
    className?: string
    activeKey?: string | string[]
    defaultActiveKey?: string | string[]
    ghost?: boolean
    expandIcon?: (props: { isActive: boolean }) => ReactNode
    onChange?: (keys: string[]) => void
  }) => {
    const [innerKeys, setInnerKeys] = useState<string[]>(normalizeKeys(defaultActiveKey))
    const isControlled = activeKey !== undefined
    const resolvedKeys = isControlled ? normalizeKeys(activeKey) : innerKeys

    return (
      <div className={['ant-collapse', ghost ? 'ant-collapse-ghost' : '', className].filter(Boolean).join(' ')}>
        {items.map((item) => {
          const itemKey = String(item.key)
          const isActive = resolvedKeys.includes(itemKey)

          const toggleItem = () => {
            const nextKeys = isActive ? resolvedKeys.filter((key) => key !== itemKey) : [...resolvedKeys, itemKey]
            if (!isControlled) {
              setInnerKeys(nextKeys)
            }
            onChange?.(nextKeys)
          }

          return (
            <div
              key={itemKey}
              className={['ant-collapse-item', isActive ? 'ant-collapse-item-active' : ''].filter(Boolean).join(' ')}>
              <div
                className={['ant-collapse-header', item.classNames?.header].filter(Boolean).join(' ')}
                onClick={toggleItem}>
                <div className="ant-collapse-header-text">{item.label}</div>
                <div className="ant-collapse-expand-icon">{expandIcon?.({ isActive })}</div>
              </div>
              <div className="ant-collapse-content">
                <div className={['ant-collapse-content-box', item.classNames?.body].filter(Boolean).join(' ')}>
                  {item.children}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return {
    Collapse,
    ConfigProvider: ({ children }: { children: ReactNode }) => children,
    Flex: ({ children, className }: { children: ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
    Progress: ({ percent }: { percent: number }) => <div data-testid="progress">{percent}</div>,
    Tooltip: ({ children }: { children: ReactNode }) => children
  }
})

vi.mock('@renderer/context/CodeStyleProvider', () => ({
  useCodeStyle: () => ({
    highlightCode: vi.fn(async (content: string) => content)
  })
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({
    messageFont: 'sans',
    fontSize: 14
  })
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: vi.fn()
  })
}))

vi.mock('@renderer/utils/mcp-tools', () => ({
  isToolAutoApproved: vi.fn(() => false)
}))

vi.mock('@shared/IpcChannel', () => ({
  IpcChannel: {
    Mcp_Progress: 'Mcp_Progress'
  }
}))

vi.mock('../hooks/useToolApproval', () => ({
  useToolApproval: (...args: unknown[]) => mockUseToolApproval(...args)
}))

vi.mock('../hooks/useAgentToolApproval', () => ({
  useAgentToolApproval: (...args: unknown[]) => mockUseAgentToolApproval(...args)
}))

vi.mock('../ToolApprovalActions', () => ({
  default: () => <div data-testid="approval-actions">approval-actions</div>
}))

vi.mock('../MessageTools', () => ({
  default: ({ block }: { block: { id: string } }) => <div data-testid={`tool-item-${block.id}`}>tool-item</div>
}))

vi.mock('@renderer/components/Icons', () => ({
  CopyIcon: () => <span data-testid="copy-icon">copy</span>,
  LoadingIcon: () => <span data-testid="loading-icon">loading</span>
}))

const applyTheme = () => {
  document.body.setAttribute('theme-mode', 'light')
  const style = document.createElement('style')
  style.setAttribute('data-testid', 'theme-style')
  style.textContent = `
    :root {
      --list-item-border-radius: 10px;
      --color-border: rgba(31, 41, 55, 0.15);
      --color-background: rgb(243, 244, 246);
      --color-background-soft: rgb(229, 231, 235);
      --color-text: rgb(31, 41, 55);
      --color-text-1: rgb(31, 41, 55);
      --color-text-2: rgba(31, 41, 55, 0.6);
      --color-text-3: rgba(31, 41, 55, 0.38);
      --color-primary: rgb(75, 85, 99);
      --status-color-success: rgb(75, 85, 99);
      --font-family: system-ui;
      --font-family-serif: serif;
    }

    body[theme-mode='light'] .ant-collapse {
      background-color: rgb(185, 190, 199);
    }

    body[theme-mode='light'] .ant-collapse-content {
      background-color: rgb(205, 209, 217);
    }
  `
  document.head.appendChild(style)
  return style
}

const applyStrongTheme = () => {
  document.body.setAttribute('theme-mode', 'light')
  const style = document.createElement('style')
  style.setAttribute('data-testid', 'theme-style-strong')
  style.textContent = `
    body[theme-mode='light'] .ant-collapse {
      background-color: rgb(185, 190, 199) !important;
    }

    body[theme-mode='light'] .ant-collapse-header {
      background-color: rgb(190, 194, 202) !important;
    }

    body[theme-mode='light'] .ant-collapse-content {
      background-color: rgb(205, 209, 217) !important;
      border-radius: 18px !important;
    }
  `
  document.head.appendChild(style)
  return style
}

const getStyleRuleText = (selectorFragment: string) => {
  for (const styleSheet of Array.from(document.styleSheets)) {
    const rules = Array.from(styleSheet.cssRules ?? [])
    for (const rule of rules) {
      if (rule.cssText.includes(selectorFragment)) {
        return rule.cssText
      }
    }
  }
  return ''
}

const createAgentToolResponse = (overrides: Partial<NormalToolResponse> = {}): NormalToolResponse => ({
  id: 'agent-tool-1',
  toolCallId: 'call-1',
  tool: {
    id: 'Search',
    name: 'Search',
    description: 'Search tool',
    type: 'provider'
  },
  arguments: 'radius test',
  response: 'one\ntwo',
  status: 'done',
  ...overrides
})

const createToolBlock = (id: string, overrides: Record<string, unknown> = {}) =>
  ({
    id,
    messageId: 'message-1',
    metadata: {
      rawMcpToolResponse: createAgentToolResponse(overrides)
    }
  }) as any

const createMcpBlock = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'mcp-block-1',
    messageId: 'message-1',
    metadata: {
      rawMcpToolResponse: {
        id: 'mcp-call-1',
        toolCallId: 'mcp-call-1',
        tool: {
          id: 'fetch',
          name: 'fetch',
          serverId: 'server-1',
          serverName: 'server-a',
          type: 'mcp'
        },
        arguments: { url: 'https://example.com' },
        response: { isError: false, content: [] },
        partialArguments: undefined,
        status: 'done',
        ...overrides
      }
    }
  }) as any

describe('tool-call theme radius hotfix regression', () => {
  beforeEach(() => {
    currentPendingPermission = null
    mockUseAppSelector.mockImplementation((selector) => selector({ toolPermissions: { requests: {} } }))
    mockUseToolApproval.mockReturnValue({
      isWaiting: false,
      isExecuting: false,
      isSubmitting: false,
      confirm: vi.fn(),
      cancel: vi.fn(),
      autoApprove: undefined
    })
    mockUseAgentToolApproval.mockReturnValue({
      isWaiting: true,
      isExecuting: false,
      isSubmitting: false,
      input: 'radius test',
      confirm: vi.fn(),
      cancel: vi.fn(),
      autoApprove: undefined
    })
    window.electron.ipcRenderer.on = vi.fn(() => () => {})
  })

  afterEach(() => {
    cleanup()
    document.body.removeAttribute('theme-mode')
    document.querySelector('[data-testid="theme-style"]')?.remove()
    document.querySelector('[data-testid="theme-style-strong"]')?.remove()
    vi.clearAllMocks()
  })

  it('uses a dedicated outer shell for generic agent tool cards under themed collapse styles', () => {
    applyTheme()

    const { container } = render(<MessageAgentTools toolResponse={createAgentToolResponse()} />)
    const collapse = container.querySelector('.ant-collapse') as HTMLElement
    const shell = collapse.parentElement as HTMLElement
    const content = container.querySelector('.ant-collapse-content') as HTMLElement

    expect(getComputedStyle(shell).borderRadius).toBe('8px')
    expect(getComputedStyle(shell).overflow).toBe('hidden')
    expect(getComputedStyle(collapse).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(getComputedStyle(content).backgroundColor).toBe('rgba(0, 0, 0, 0)')
  })

  it('emits explicit neutralization rules for generic agent tool headers under strong custom theme rules', () => {
    const { container } = render(<MessageAgentTools toolResponse={createAgentToolResponse()} />)

    applyStrongTheme()

    const collapse = container.querySelector('.ant-collapse') as HTMLElement
    const shellClassName = Array.from((collapse.parentElement as HTMLElement).classList).find(
      (className) => !className.startsWith('sc-')
    ) as string
    const headerRuleText = getStyleRuleText(`.${shellClassName}.${shellClassName} .ant-collapse-header`)

    expect(headerRuleText).toContain('background-color: transparent !important')
    expect(headerRuleText).toContain('background: transparent !important')
  })

  it('keeps grouped tool-call cards on a single rounded shell under themed collapse styles', () => {
    applyTheme()

    const blocks = [
      createToolBlock('tool-block-1', { status: 'done' }),
      createToolBlock('tool-block-2', { status: 'done' })
    ]

    const { container } = render(<ToolBlockGroup blocks={blocks} />)
    const collapse = container.querySelector('.ant-collapse') as HTMLElement
    const shell = collapse.parentElement as HTMLElement
    const content = container.querySelector('.ant-collapse-content') as HTMLElement

    expect(getComputedStyle(shell).borderRadius).toBe('0.75rem')
    expect(getComputedStyle(shell).overflow).toBe('hidden')
    expect(getComputedStyle(collapse).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(getComputedStyle(content).backgroundColor).toBe('rgba(0, 0, 0, 0)')
  })

  it('keeps MCP tool cards on a single rounded shell while preserving the bottom actions area', () => {
    applyTheme()

    mockUseToolApproval.mockReturnValue({
      isWaiting: true,
      isExecuting: false,
      isSubmitting: false,
      confirm: vi.fn(),
      cancel: vi.fn(),
      autoApprove: undefined
    })

    const { container } = render(<MessageMcpTool block={createMcpBlock()} />)
    const collapse = container.querySelector('.message-tools-container') as HTMLElement
    const shell = collapse.parentElement as HTMLElement
    const content = container.querySelector('.ant-collapse-content') as HTMLElement

    expect(screen.getByTestId('approval-actions')).toBeInTheDocument()
    expect(shell.contains(screen.getByTestId('approval-actions'))).toBe(true)
    expect(getComputedStyle(shell).borderRadius).toBe('8px')
    expect(getComputedStyle(shell).overflow).toBe('hidden')
    expect(getComputedStyle(collapse).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(getComputedStyle(content).backgroundColor).toBe('rgba(0, 0, 0, 0)')
  })

  it('emits explicit high-specificity neutralization rules for MCP collapse internals', () => {
    const { container } = render(<MessageMcpTool block={createMcpBlock()} />)

    applyStrongTheme()

    const collapse = container.querySelector('.message-tools-container') as HTMLElement
    const collapseClassName = Array.from(collapse.classList).find(
      (className) =>
        className !== 'message-tools-container' && !className.startsWith('ant-') && !className.startsWith('sc-')
    ) as string
    const headerRuleText = getStyleRuleText(`.${collapseClassName}.${collapseClassName} .ant-collapse-header`)
    const contentRuleText = getStyleRuleText(`.${collapseClassName}.${collapseClassName} .ant-collapse-content`)

    expect(headerRuleText).toContain('background-color: transparent !important')
    expect(headerRuleText).toContain('background: transparent !important')
    expect(contentRuleText).toContain('background-color: transparent !important')
    expect(contentRuleText).toContain('background: transparent !important')
    expect(contentRuleText).toContain('border-radius: 0 !important')
  })

  it('uses a single header-to-body divider for MCP response-only content', async () => {
    applyTheme()

    const { container } = render(
      <MessageMcpTool
        block={createMcpBlock({
          arguments: undefined,
          response: {
            isError: false,
            content: [{ type: 'text', text: '{"ok":true}' }]
          }
        })}
      />
    )

    const header = container.querySelector('.ant-collapse-header') as HTMLElement
    fireEvent.click(header)

    const responseTitle = await screen.findByText('Response')
    const collapseContent = container.querySelector('.ant-collapse-content') as HTMLElement
    const responseSection = responseTitle.parentElement as HTMLElement
    const collapseClassName = Array.from(collapseContent.parentElement?.parentElement?.classList ?? []).find(
      (className) =>
        className !== 'message-tools-container' && !className.startsWith('ant-') && !className.startsWith('sc-')
    ) as string
    const responseClassName = Array.from(responseSection.classList).find((className) => !className.startsWith('sc-'))
    const collapseRuleText = getStyleRuleText(`.${collapseClassName} .ant-collapse-content`)
    const responseRuleText = getStyleRuleText(`.${responseClassName}`)

    expect(collapseRuleText).not.toContain('border-top')
    expect(responseRuleText).toContain('border-top: 1px solid var(--color-border)')
  })

  it('neutralizes themed inner collapse backgrounds inside permission request cards', () => {
    applyTheme()
    currentPendingPermission = {
      requestId: 'request-1',
      toolCallId: 'call-1',
      toolName: 'Search',
      status: 'pending',
      input: 'radius test'
    }

    const { container } = render(<ToolPermissionRequestCard toolResponse={createAgentToolResponse()} />)
    const collapse = container.querySelector('.ant-collapse') as HTMLElement
    const shell = collapse.parentElement as HTMLElement
    const content = container.querySelector('.ant-collapse-content') as HTMLElement

    expect(getComputedStyle(shell).borderRadius).toBe('0.75rem')
    expect(getComputedStyle(shell).overflow).toBe('hidden')
    expect(getComputedStyle(collapse).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(getComputedStyle(content).backgroundColor).toBe('rgba(0, 0, 0, 0)')
  })
})
