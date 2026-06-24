import { defaultMessageMenuConfig, type MessageListActions } from '@renderer/components/chat/messages/types'
import { DEFAULT_MESSAGE_MENUBAR_BUTTON_IDS, getMessageMenuBarConfig } from '@renderer/config/registry/messageMenuBar'
import { TopicType } from '@renderer/types'
import { COMPOSER_CLIPBOARD_FRAGMENT_MIME } from '@renderer/utils/message/composerClipboard'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps, MouseEvent, ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

const tooltipOpenValues = vi.hoisted(() => [] as Array<boolean | undefined>)

vi.mock('@cherrystudio/ui', async () => {
  return {
    Button: ({ children, type = 'button', ...props }: ComponentProps<'button'>) => (
      <button type={type} {...props}>
        {children}
      </button>
    ),
    ConfirmDialog: ({ open, title }: { open?: boolean; title?: ReactNode }) =>
      open ? <div role="dialog">{title}</div> : null,
    Tooltip: ({
      children,
      isOpen,
      onOpenChange
    }: {
      children?: ReactNode
      content?: ReactNode
      delay?: number
      isOpen?: boolean
      onOpenChange?: (open: boolean) => void
    }) => {
      tooltipOpenValues.push(isOpen)
      return (
        <div data-testid="mock-tooltip">
          {children}
          {onOpenChange && (
            <button
              type="button"
              data-testid="mock-tooltip-trigger"
              onClick={(e) => {
                e.stopPropagation()
                onOpenChange(true)
              }}
            />
          )}
        </div>
      )
    }
  }
})

vi.mock('@renderer/components/command', async () => {
  const React = await import('react')

  return {
    CommandPopupMenu: ({
      children,
      extraItems = [],
      onOpenChange
    }: {
      children: ReactNode
      extraItems?: Array<{ id: string; label: ReactNode; onSelect?: () => void }>
      onOpenChange?: (open: boolean) => void
    }) => {
      const [open, setOpen] = React.useState(false)
      const child = React.isValidElement<{ onClick?: (event: MouseEvent) => void }>(children) ? children : null
      const trigger = child
        ? // eslint-disable-next-line @eslint-react/no-clone-element -- Mirrors CommandPopupMenu's asChild trigger path.
          React.cloneElement(child as ReactElement<{ onClick?: (event: MouseEvent) => void }>, {
            onClick: (event: MouseEvent) => {
              child.props.onClick?.(event)
              setOpen(true)
              onOpenChange?.(true)
            }
          })
        : children

      return (
        <>
          {trigger}
          {open && (
            <div role="menu">
              <button
                type="button"
                data-testid="mock-menu-close"
                onClick={() => {
                  setOpen(false)
                  onOpenChange?.(false)
                }}
              />
              {extraItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onOpenChange?.(false)
                    item.onSelect?.()
                  }}>
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </>
      )
    }
  }
})

vi.mock('@renderer/services/MessagesService', () => ({
  getMessageTitle: vi.fn()
}))

vi.mock('@renderer/utils/export', () => ({
  messageToMarkdown: vi.fn(),
  messageToPlainText: vi.fn(() => 'plain text')
}))

import type { MessageMenuBarActionContext } from '../messageMenuBarActions'
import {
  executeMessageMenuBarAction,
  resolveMessageMenuBarMenuActions,
  resolveMessageMenuBarToolbarActions,
  resolveMessageMenuBarTranslationItems
} from '../messageMenuBarActions'
import {
  renderModelPickerToolbarAction,
  renderMoreMenuToolbarAction,
  renderTranslateToolbarAction
} from '../MessageMenuBarToolbarRenderers'

const t = ((key: string) => key) as any

function createContext(overrides: Partial<MessageMenuBarActionContext> = {}): MessageMenuBarActionContext {
  const baseActions = {
    copyText: vi.fn(),
    copyImage: vi.fn(),
    notifySuccess: vi.fn(),
    notifyWarning: vi.fn(),
    notifyError: vi.fn()
  } as MessageListActions

  return {
    message: {
      id: 'message-1',
      role: 'assistant',
      topicId: 'topic-1',
      parentId: 'parent-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    },
    messageParts: [],
    messageForExport: {
      id: 'message-1',
      role: 'assistant',
      topicId: 'topic-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success',
      parts: []
    } as any,
    messageContainerRef: { current: null } as any,
    mainTextContent: 'hello',
    toolbarButtonIds: new Set(DEFAULT_MESSAGE_MENUBAR_BUTTON_IDS),
    menuConfig: defaultMessageMenuConfig,
    copied: false,
    setCopied: vi.fn(),
    isAssistantMessage: true,
    isLastMessage: false,
    isProcessing: false,
    isTranslating: false,
    hasTranslationBlocks: false,
    isUserMessage: false,
    isUseful: false,
    isEditable: true,
    translateLanguages: [],
    startEditingMessage: vi.fn(),
    t,
    ...overrides,
    actions: {
      ...baseActions,
      ...overrides.actions
    }
  }
}

describe('messageMenuBarActions', () => {
  it('keeps write actions hidden when capabilities are absent', () => {
    const toolbarActions = resolveMessageMenuBarToolbarActions(
      createContext({
        message: {
          id: 'message-1',
          role: 'user',
          topicId: 'topic-1',
          parentId: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'success'
        },
        isAssistantMessage: false,
        isUserMessage: true
      })
    )

    expect(toolbarActions.map((action) => action.id)).toEqual(['copy'])
  })

  it('keeps user edit toolbar action for root messages', () => {
    const toolbarActions = resolveMessageMenuBarToolbarActions(
      createContext({
        message: {
          id: 'message-1',
          role: 'user',
          topicId: 'topic-1',
          parentId: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'success'
        },
        actions: {
          editMessage: vi.fn()
        } as MessageListActions,
        isAssistantMessage: false,
        isUserMessage: true
      })
    )

    expect(toolbarActions.map((action) => action.id)).toEqual(['user-edit', 'copy'])
  })

  it('keeps user edit toolbar action for non-root messages', () => {
    const toolbarActions = resolveMessageMenuBarToolbarActions(
      createContext({
        message: {
          id: 'message-1',
          role: 'user',
          topicId: 'topic-1',
          parentId: 'assistant-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'success'
        },
        actions: {
          editMessage: vi.fn()
        } as MessageListActions,
        isAssistantMessage: false,
        isUserMessage: true
      })
    )

    expect(toolbarActions.map((action) => action.id)).toEqual(['user-edit', 'copy'])
  })

  it('keeps edit menu action for root messages', () => {
    const menuActions = resolveMessageMenuBarMenuActions(
      createContext({
        message: {
          id: 'message-1',
          role: 'user',
          topicId: 'topic-1',
          parentId: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'success'
        },
        actions: {
          editMessage: vi.fn()
        } as MessageListActions,
        isAssistantMessage: false,
        isUserMessage: true
      })
    )

    expect(menuActions.map((action) => action.id)).toContain('edit')
  })

  it('resolves assistant toolbar actions from capabilities', () => {
    const toolbarActions = resolveMessageMenuBarToolbarActions(
      createContext({
        actions: {
          deleteMessage: vi.fn(),
          exportToNotes: vi.fn(),
          regenerateMessage: vi.fn(),
          renderRegenerateModelPicker: vi.fn(),
          translateMessage: vi.fn()
        } as MessageListActions,
        translateLanguages: [{ langCode: 'en', emoji: '🇺🇸', label: 'English' } as any],
        isGrouped: true
      })
    )

    expect(toolbarActions.map((action) => action.id)).toEqual([
      'copy',
      'assistant-regenerate',
      'assistant-mention-model',
      'translate',
      'useful',
      'notes',
      'delete',
      'more-menu'
    ])
    expect(toolbarActions.find((action) => action.id === 'copy')?.renderToolbar).toBeUndefined()
    expect(typeof toolbarActions.find((action) => action.id === 'assistant-mention-model')?.renderToolbar).toBe(
      'function'
    )
    expect(typeof toolbarActions.find((action) => action.id === 'translate')?.renderToolbar).toBe('function')
    expect(typeof toolbarActions.find((action) => action.id === 'delete')?.renderToolbar).toBe('function')
    expect(typeof toolbarActions.find((action) => action.id === 'more-menu')?.renderToolbar).toBe('function')
  })

  it('does not require confirmation before regenerating an assistant message', () => {
    const toolbarActions = resolveMessageMenuBarToolbarActions(
      createContext({
        actions: {
          regenerateMessage: vi.fn()
        } as MessageListActions
      })
    )

    expect(toolbarActions.find((action) => action.id === 'assistant-regenerate')?.confirm).toBeUndefined()
  })

  it('renders mention-model picker with a direct button trigger', () => {
    const renderRegenerateModelPicker = vi.fn(({ trigger }) => <div data-testid="model-picker">{trigger}</div>)
    const context = createContext({
      actions: { renderRegenerateModelPicker } as unknown as MessageListActions
    })
    const action = resolveMessageMenuBarToolbarActions(context).find((item) => item.id === 'assistant-mention-model')

    expect(action).toBeTruthy()

    render(
      renderModelPickerToolbarAction({
        action: action!,
        actionContext: context,
        executeAction: vi.fn(),
        menuActions: [],
        softHoverBg: false,
        translationItems: []
      })
    )

    expect(renderRegenerateModelPicker).toHaveBeenCalledWith(
      expect.objectContaining({
        message: context.message,
        messageParts: context.messageParts
      })
    )
    expect(screen.getByTestId('model-picker')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'message.mention.title' })).toHaveClass('message-action-button')
  })

  it('keeps the more menu tooltip controlled while opening the menu with one click', () => {
    tooltipOpenValues.length = 0

    const context = createContext()
    const action = resolveMessageMenuBarToolbarActions(context).find((item) => item.id === 'more-menu')
    const executeAction = vi.fn()

    expect(action).toBeTruthy()

    render(
      renderMoreMenuToolbarAction({
        action: action!,
        actionContext: context,
        executeAction,
        menuActions: [
          {
            id: 'copy',
            label: 'Copy',
            icon: null,
            danger: false,
            availability: { visible: true, enabled: true },
            children: []
          }
        ],
        softHoverBg: false,
        translationItems: []
      })
    )

    // Simulate opening the tooltip
    fireEvent.click(screen.getByTestId('mock-tooltip-trigger'))
    expect(tooltipOpenValues[tooltipOpenValues.length - 1]).toBe(true)

    // Click to open the more menu
    fireEvent.click(screen.getByRole('button', { name: 'chat.message.more' }))

    expect(screen.getByRole('menu')).toBeInTheDocument()
    // The tooltip must be immediately hidden when the menu opens
    expect(tooltipOpenValues[tooltipOpenValues.length - 1]).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(executeAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'copy' }))
    expect(tooltipOpenValues).not.toContain(undefined)
  })

  it('suppresses the more menu tooltip after the menu closes until the trigger is left', () => {
    tooltipOpenValues.length = 0

    const MessageMenuActionContext = createContext()
    const action = resolveMessageMenuBarToolbarActions(MessageMenuActionContext).find((item) => item.id === 'more-menu')

    expect(action).toBeTruthy()

    render(
      renderMoreMenuToolbarAction({
        action: action!,
        actionContext: MessageMenuActionContext,
        executeAction: vi.fn(),
        menuActions: [
          {
            id: 'copy',
            label: 'Copy',
            icon: null,
            danger: false,
            availability: { visible: true, enabled: true },
            children: []
          }
        ],
        softHoverBg: false,
        translationItems: []
      })
    )

    const trigger = screen.getByRole('button', { name: 'chat.message.more' })
    const tooltipTrigger = screen.getByTestId('mock-tooltip-trigger')

    fireEvent.click(tooltipTrigger)
    expect(tooltipOpenValues[tooltipOpenValues.length - 1]).toBe(true)

    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(tooltipOpenValues[tooltipOpenValues.length - 1]).toBe(false)

    fireEvent.click(screen.getByTestId('mock-menu-close'))
    expect(tooltipOpenValues[tooltipOpenValues.length - 1]).toBe(false)

    fireEvent.click(tooltipTrigger)
    expect(tooltipOpenValues[tooltipOpenValues.length - 1]).toBe(false)

    fireEvent.pointerLeave(trigger)
    fireEvent.click(tooltipTrigger)
    expect(tooltipOpenValues[tooltipOpenValues.length - 1]).toBe(true)
  })

  it('keeps the translate tooltip controlled while opening the language menu with one click', () => {
    tooltipOpenValues.length = 0

    const context = createContext({
      actions: {
        translateMessage: vi.fn()
      } as unknown as MessageListActions,
      translateLanguages: [{ langCode: 'fr', label: 'French' } as any]
    })
    const action = resolveMessageMenuBarToolbarActions(context).find((item) => item.id === 'translate')
    const onSelect = vi.fn()

    expect(action).toBeTruthy()

    render(
      renderTranslateToolbarAction({
        action: action!,
        actionContext: context,
        executeAction: vi.fn(),
        menuActions: [],
        softHoverBg: false,
        translationItems: [{ key: 'fr', label: 'French', onSelect }]
      })
    )

    // Simulate opening the tooltip
    fireEvent.click(screen.getByTestId('mock-tooltip-trigger'))
    expect(tooltipOpenValues[tooltipOpenValues.length - 1]).toBe(true)

    // Click to open the translate menu by its accessible name
    fireEvent.click(screen.getByRole('button', { name: 'chat.translate' }))

    expect(screen.getByRole('menu')).toBeInTheDocument()
    // The tooltip must be immediately hidden when the menu opens
    expect(tooltipOpenValues[tooltipOpenValues.length - 1]).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'French' }))

    expect(onSelect).toHaveBeenCalled()
    expect(tooltipOpenValues).not.toContain(undefined)
  })

  it('suppresses the translate tooltip after the language menu closes until a new trigger hover starts', () => {
    tooltipOpenValues.length = 0

    const MessageMenuActionContext = createContext({
      actions: {
        translateMessage: vi.fn()
      } as unknown as MessageListActions,
      translateLanguages: [{ langCode: 'fr', label: 'French' } as any]
    })
    const action = resolveMessageMenuBarToolbarActions(MessageMenuActionContext).find((item) => item.id === 'translate')

    expect(action).toBeTruthy()

    render(
      renderTranslateToolbarAction({
        action: action!,
        actionContext: MessageMenuActionContext,
        executeAction: vi.fn(),
        menuActions: [],
        softHoverBg: false,
        translationItems: [{ key: 'fr', label: 'French', onSelect: vi.fn() }]
      })
    )

    const trigger = screen.getByRole('button', { name: 'chat.translate' })
    const tooltipTrigger = screen.getByTestId('mock-tooltip-trigger')

    fireEvent.click(tooltipTrigger)
    expect(tooltipOpenValues[tooltipOpenValues.length - 1]).toBe(true)

    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(tooltipOpenValues[tooltipOpenValues.length - 1]).toBe(false)

    fireEvent.click(screen.getByTestId('mock-menu-close'))
    expect(tooltipOpenValues[tooltipOpenValues.length - 1]).toBe(false)

    fireEvent.click(tooltipTrigger)
    expect(tooltipOpenValues[tooltipOpenValues.length - 1]).toBe(false)

    fireEvent.pointerEnter(trigger)
    fireEvent.click(tooltipTrigger)
    expect(tooltipOpenValues[tooltipOpenValues.length - 1]).toBe(true)
  })

  it('keeps session scope capability-driven for toolbar actions', () => {
    const sessionConfig = getMessageMenuBarConfig(TopicType.Session)
    const toolbarActions = resolveMessageMenuBarToolbarActions(
      createContext({
        actions: {
          deleteMessage: vi.fn(),
          exportToNotes: vi.fn(),
          regenerateMessage: vi.fn(),
          renderRegenerateModelPicker: vi.fn(),
          translateMessage: vi.fn()
        } as MessageListActions,
        translateLanguages: [{ langCode: 'en', emoji: '🇺🇸', label: 'English' } as any],
        toolbarButtonIds: new Set(sessionConfig.buttonIds)
      })
    )

    expect(toolbarActions.map((action) => action.id)).toEqual(['copy', 'notes', 'delete', 'more-menu'])
  })

  it('keeps menu actions capability-driven instead of filtering by session roots', () => {
    const menuActions = resolveMessageMenuBarMenuActions(
      createContext({
        actions: {
          exportMessageAsMarkdown: vi.fn(),
          saveTextFile: vi.fn(),
          startMessageBranch: vi.fn(),
          toggleMultiSelectMode: vi.fn()
        } as MessageListActions,
        selection: {
          enabled: true,
          isMultiSelectMode: false,
          selectedMessageIds: []
        },
        menuConfig: {
          ...defaultMessageMenuConfig,
          exportMenuOptions: {
            ...defaultMessageMenuConfig.exportMenuOptions,
            markdown: true
          }
        }
      })
    )

    expect(menuActions.map((action) => action.id)).toEqual(['new-branch', 'multi-select', 'save', 'export'])
    expect(menuActions[2]?.children.map((action) => action.id)).toEqual(['save.file'])
    expect(menuActions[3]?.children.map((action) => action.id)).toEqual(['export.markdown'])
  })

  it('hides new branch from the latest message menu', () => {
    const menuActions = resolveMessageMenuBarMenuActions(
      createContext({
        actions: {
          startMessageBranch: vi.fn(),
          toggleMultiSelectMode: vi.fn()
        } as MessageListActions,
        isLastMessage: true,
        selection: {
          enabled: true,
          isMultiSelectMode: false,
          selectedMessageIds: []
        }
      })
    )

    expect(menuActions.map((action) => action.id)).toEqual(['multi-select'])
  })

  it('hides new branch from user message menus', () => {
    const menuActions = resolveMessageMenuBarMenuActions(
      createContext({
        actions: {
          startMessageBranch: vi.fn(),
          toggleMultiSelectMode: vi.fn()
        } as MessageListActions,
        isAssistantMessage: false,
        isUserMessage: true,
        selection: {
          enabled: true,
          isMultiSelectMode: false,
          selectedMessageIds: []
        }
      })
    )

    expect(menuActions.map((action) => action.id)).toEqual(['multi-select'])
  })

  it('disables streaming-unsafe toolbar actions while keeping copy enabled', () => {
    const toolbarActions = resolveMessageMenuBarToolbarActions(
      createContext({
        actions: {
          deleteMessage: vi.fn(),
          regenerateMessage: vi.fn()
        } as MessageListActions,
        isProcessing: true
      })
    )

    expect(toolbarActions.find((action) => action.id === 'copy')?.availability.enabled).toBe(true)
    expect(toolbarActions.find((action) => action.id === 'assistant-regenerate')?.availability.enabled).toBe(false)
    expect(toolbarActions.find((action) => action.id === 'delete')?.availability.enabled).toBe(false)
  })

  it('resolves translation language items through the injected translate action', async () => {
    const translateMessage = vi.fn()
    const language = { langCode: 'fr', label: 'French' } as any
    const translationItems = resolveMessageMenuBarTranslationItems(
      createContext({
        actions: { translateMessage } as MessageListActions,
        translateLanguages: [language],
        getTranslationLanguageLabel: () => 'French'
      })
    )

    expect(translationItems).toHaveLength(1)
    expect(translationItems[0]).toMatchObject({ key: 'fr', label: 'French' })

    const item = translationItems[0]
    if (!item || 'type' in item) {
      throw new Error('Expected a translation action item')
    }

    await item.onSelect()

    expect(translateMessage).toHaveBeenCalledWith('message-1', language, 'hello')
  })

  it('keeps copy-translation item available without translate capability', () => {
    const translationItems = resolveMessageMenuBarTranslationItems(
      createContext({
        hasTranslationBlocks: true,
        messageParts: [{ type: 'data-translation', data: { content: 'translated text' } }] as any
      })
    )

    expect(translationItems.map((item) => item.key)).toEqual(['translate-copy'])
  })

  it('adds a close-translation item that removes the translation and notifies', async () => {
    const removeMessageTranslation = vi.fn()
    const notifySuccess = vi.fn()
    const translationItems = resolveMessageMenuBarTranslationItems(
      createContext({
        hasTranslationBlocks: true,
        messageParts: [{ type: 'data-translation', data: { content: 'translated text' } }] as any,
        actions: { copyText: vi.fn(), removeMessageTranslation, notifySuccess } as MessageListActions
      })
    )

    expect(translationItems.map((item) => item.key)).toEqual(['translate-copy', 'translate-close'])

    const closeItem = translationItems.find((item) => item.key === 'translate-close')
    if (!closeItem || 'type' in closeItem) {
      throw new Error('Expected a translate-close action item')
    }

    await closeItem.onSelect()

    expect(removeMessageTranslation).toHaveBeenCalledWith('message-1')
    expect(notifySuccess).toHaveBeenCalledWith('translate.closed')
  })

  it('enables the translate toolbar action as abort while translation is running', () => {
    const toolbarActions = resolveMessageMenuBarToolbarActions(
      createContext({
        actions: { abortMessageTranslation: vi.fn() } as MessageListActions,
        isTranslating: true
      })
    )

    expect(toolbarActions.find((action) => action.id === 'translate')?.availability.enabled).toBe(true)
  })

  it('routes copy through the injected clipboard action', async () => {
    const copyText = vi.fn()
    const setCopied = vi.fn()
    const context = createContext({
      actions: { copyText } as MessageListActions,
      setCopied
    })

    await executeMessageMenuBarAction('copy', context)

    expect(copyText).toHaveBeenCalledWith('hello', { successMessage: 'message.copied' })
    expect(setCopied).toHaveBeenCalledWith(true)
  })

  it('copies user composer tokens through rich clipboard when available', async () => {
    const copyText = vi.fn()
    const copyRichContent = vi.fn()
    const setCopied = vi.fn()
    const context = createContext({
      actions: { copyText, copyRichContent } as unknown as MessageListActions,
      message: {
        id: 'message-1',
        role: 'user',
        topicId: 'topic-1',
        parentId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        status: 'success'
      },
      messageParts: [
        {
          type: 'text',
          text: ' Use the pdf skill. hello  \nworld',
          providerMetadata: {
            cherry: {
              composer: {
                version: 1,
                tokens: [
                  {
                    id: 'skill:pdf',
                    kind: 'skill',
                    label: 'PDF',
                    index: 0,
                    textOffset: 1,
                    promptText: 'Use the pdf skill.'
                  }
                ]
              }
            }
          }
        }
      ] as any,
      isAssistantMessage: false,
      isUserMessage: true,
      setCopied
    })

    await executeMessageMenuBarAction('copy', context)

    expect(copyText).not.toHaveBeenCalled()
    expect(copyRichContent).toHaveBeenCalledWith(
      expect.objectContaining({
        plainText: '/pdf/ hello\nworld',
        customFormats: expect.objectContaining({
          [COMPOSER_CLIPBOARD_FRAGMENT_MIME]: expect.stringContaining('"kind":"skill"')
        })
      }),
      { successMessage: 'message.copied' }
    )
    expect(setCopied).toHaveBeenCalledWith(true)
  })

  it('reports command failures without marking copy as complete', async () => {
    const copyText = vi.fn().mockRejectedValue(new Error('clipboard denied'))
    const notifyError = vi.fn()
    const setCopied = vi.fn()
    const context = createContext({
      actions: { copyText, notifyError } as MessageListActions,
      setCopied
    })

    await expect(executeMessageMenuBarAction('copy', context)).resolves.toBe(false)

    expect(notifyError).toHaveBeenCalledWith(expect.stringContaining('clipboard denied'))
    expect(setCopied).not.toHaveBeenCalled()
  })
})
