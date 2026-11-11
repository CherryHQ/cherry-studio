import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps, MouseEvent, ReactElement, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { describe, expect, it, vi } from 'vitest'

import { defaultMessageMenuConfig, type MessageListActions } from '@renderer/components/chat/messages/types'
import { exportService, getMessageTitle } from '@renderer/services/ExportService'
import { COMPOSER_CLIPBOARD_FRAGMENT_MIME } from '@renderer/utils/message/composerClipboard'

const tooltipOpenValues = vi.hoisted(() => [] as Array<boolean | undefined>)
const readMessageAloud = vi.hoisted(() => vi.fn())

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
      content,
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
        <div data-testid="mock-tooltip" data-content={typeof content === 'string' ? content : undefined}>
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

vi.mock('@renderer/services/ExportService', () => ({
  exportService: {
    captureScrollableAsBlob: vi.fn(),
    captureScrollableAsDataUrl: vi.fn()
  },
  getMessageTitle: vi.fn(),
  messageToMarkdown: vi.fn()
}))

vi.mock('@renderer/services/voice', () => ({ readMessageAloud }))

vi.mock('@renderer/utils/export', () => ({
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
  renderDeleteToolbarAction,
  renderModelPickerToolbarAction,
  renderMoreMenuToolbarAction,
  renderTranslateToolbarAction
} from '../MessageMenuBarToolbarRenderers'

const t = ((key: string) => key) as any

function createActionContext(overrides: Partial<MessageMenuBarActionContext> = {}): MessageMenuBarActionContext {
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
    menuConfig: defaultMessageMenuConfig,
    copied: false,
    setCopied: vi.fn(),
    isAssistantMessage: true,
    isLastMessage: false,
    isProcessing: false,
    isTranslating: false,
    hasTranslationBlocks: false,
    isUserMessage: false,
    isSelectedForContext: false,
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
  it('uses the injected fork label and availability without owning session policy', async () => {
    const forkSession = vi.fn()
    const availability = vi.fn(() => ({ visible: true, enabled: true, reason: undefined as string | undefined }))
    const context = createActionContext({
      actions: { forkSession: { label: 'Fork this conversation', availability, run: forkSession } },
      isProcessing: true,
      isLastMessage: false
    })
    const forkAction = () => resolveMessageMenuBarMenuActions(context).find((action) => action.id === 'fork-session')!
    expect(forkAction().availability.enabled).toBe(true)
    expect(forkAction().label).toBe('Fork this conversation')
    await executeMessageMenuBarAction('fork-session', context)
    expect(forkSession).toHaveBeenCalledWith(context.message.id)
    forkSession.mockClear()
    availability.mockReturnValue({ visible: true, enabled: false, reason: 'Wait for the turn to finish' })
    expect(forkAction().availability.enabled).toBe(false)
    expect(forkAction().availability.reason).toBe('Wait for the turn to finish')
    await executeMessageMenuBarAction('fork-session', context)
    expect(forkSession).not.toHaveBeenCalled()
    availability.mockReturnValue({ visible: true, enabled: true, reason: undefined })
    expect(forkAction().availability.enabled).toBe(true)
    await executeMessageMenuBarAction('fork-session', context)
    expect(forkSession).toHaveBeenCalledWith(context.message.id)
    expect(resolveMessageMenuBarMenuActions(context).some((action) => action.id === 'new-branch')).toBe(false)
  })

  it('keeps write actions hidden when capabilities are absent', () => {
    const toolbarActions = resolveMessageMenuBarToolbarActions(
      createActionContext({
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

  it('disables deletion while the target message is unavailable', () => {
    const context = createActionContext({
      actions: {
        getMessageDeleteAvailability: vi.fn(() => ({ enabled: false, reason: 'not-loaded' })),
        deleteMessage: vi.fn()
      } as MessageListActions
    })
    const toolbarActions = resolveMessageMenuBarToolbarActions(context)

    const deleteAction = toolbarActions.find((action) => action.id === 'delete')
    expect(deleteAction?.availability).toEqual({
      visible: true,
      enabled: false,
      reason: 'message.delete.root_unavailable'
    })

    render(
      renderDeleteToolbarAction({
        action: deleteAction!,
        actionContext: context,
        executeAction: vi.fn(),
        menuActions: [],
        softHoverBg: false,
        translationItems: []
      })
    )

    const deleteButton = screen.getByRole('button')
    expect(deleteButton).toBeDisabled()
  })

  it.each(['inline', 'resend', 'blocked'])('respects the root user message edit capability: %s', (mode) => {
    const context = createActionContext({
      message: {
        id: 'message-1',
        role: 'user',
        topicId: 'topic-1',
        parentId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        status: 'success'
      },
      actions: {
        editMessage: mode === 'resend' ? undefined : vi.fn(),
        canEditMessage: mode === 'inline' ? undefined : () => mode === 'resend'
      },
      isAssistantMessage: false,
      isUserMessage: true
    })
    expect(resolveMessageMenuBarToolbarActions(context).map((action) => action.id)).toEqual(
      mode === 'blocked' ? ['copy'] : ['copy', 'user-edit']
    )
    expect(resolveMessageMenuBarMenuActions(context).some((action) => action.id === 'edit')).toBe(mode !== 'blocked')
  })

  it('hides edit actions while an assistant reply is being translated', () => {
    const context = createActionContext({
      actions: {
        editMessage: vi.fn()
      },
      isTranslating: true
    })

    expect(resolveMessageMenuBarToolbarActions(context).map((action) => action.id)).not.toContain('user-edit')
    expect(resolveMessageMenuBarMenuActions(context).map((action) => action.id)).not.toContain('edit')
  })

  it('offers regenerate for user messages when the action is available', async () => {
    const regenerateMessage = vi.fn()
    const context = createActionContext({
      message: {
        id: 'message-1',
        role: 'user',
        topicId: 'topic-1',
        parentId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        status: 'success'
      },
      actions: { regenerateMessage },
      isAssistantMessage: false,
      isUserMessage: true
    })
    const action = resolveMessageMenuBarToolbarActions(context).find((item) => item.id === 'assistant-regenerate')

    expect(action?.availability).toMatchObject({ visible: true, enabled: true })

    await executeMessageMenuBarAction('assistant-regenerate', context)

    expect(regenerateMessage).toHaveBeenCalledWith('message-1')
  })

  it('exposes read aloud only for completed assistant messages with natural-language text', () => {
    const completed = createActionContext({ messageParts: [{ type: 'text', text: 'Answer' }] as any })
    const pending = createActionContext({
      message: { ...completed.message, status: 'pending' },
      messageParts: completed.messageParts
    })
    const user = createActionContext({
      message: { ...completed.message, role: 'user' },
      messageParts: completed.messageParts,
      isAssistantMessage: false,
      isUserMessage: true
    })
    const toolOnly = createActionContext({
      messageParts: [{ type: 'dynamic-tool', toolCallId: 'tool-1', toolName: 'read', state: 'output-available' }] as any
    })

    expect(resolveMessageMenuBarToolbarActions(completed).map((action) => action.id)).toContain('read-aloud')
    expect(resolveMessageMenuBarToolbarActions(pending).map((action) => action.id)).not.toContain('read-aloud')
    expect(resolveMessageMenuBarToolbarActions(user).map((action) => action.id)).not.toContain('read-aloud')
    expect(resolveMessageMenuBarToolbarActions(toolOnly).map((action) => action.id)).not.toContain('read-aloud')
  })

  it('keeps read aloud discoverable without Voice configuration and invokes the shared helper with trigger focus', async () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    const messageParts = [{ type: 'text', text: 'Answer' }] as any
    const context = createActionContext({ messageParts })

    const action = resolveMessageMenuBarToolbarActions(context).find((item) => item.id === 'read-aloud')

    expect(action).toMatchObject({
      label: 'chat.message.read_aloud.label',
      availability: { visible: true, enabled: true }
    })
    await executeMessageMenuBarAction('read-aloud', context)
    expect(readMessageAloud).toHaveBeenCalledWith({
      messageId: 'message-1',
      parts: messageParts,
      focusOnClose: expect.any(Function)
    })

    trigger.blur()
    vi.mocked(readMessageAloud).mock.calls[0]?.[0].focusOnClose()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('does not bubble mention-model picker trigger or portal clicks to the message card', () => {
    const renderRegenerateModelPicker = vi.fn(({ trigger }) => (
      <div data-testid="model-picker">
        {trigger}
        {createPortal(<button type="button">model-a</button>, document.body)}
      </div>
    ))
    const onCardClick = vi.fn()
    const context = createActionContext({
      actions: { renderRegenerateModelPicker } as unknown as MessageListActions
    })
    const action = resolveMessageMenuBarToolbarActions(context).find((item) => item.id === 'assistant-mention-model')

    expect(action).toBeTruthy()

    render(
      <div onClick={onCardClick}>
        {renderModelPickerToolbarAction({
          action: action!,
          actionContext: context,
          executeAction: vi.fn(),
          menuActions: [],
          softHoverBg: false,
          translationItems: []
        })}
      </div>
    )

    expect(screen.getByTestId('model-picker')).toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: 'message.mention.title' })

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'model-a' }))

    expect(onCardClick).not.toHaveBeenCalled()
  })

  it('keeps the more menu tooltip controlled while opening the menu with one click', () => {
    tooltipOpenValues.length = 0

    const context = createActionContext()
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

    // Click to open the more menu
    fireEvent.click(screen.getByRole('button', { name: 'chat.message.more' }))

    expect(screen.getByRole('menu')).toBeInTheDocument()
    // The tooltip must be immediately hidden when the menu opens

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(executeAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'copy' }))
  })

  it('keeps the translate tooltip controlled while opening the language menu with one click', () => {
    tooltipOpenValues.length = 0

    const context = createActionContext({
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

    // Click to open the translate menu by its accessible name
    fireEvent.click(screen.getByRole('button', { name: 'chat.translate' }))

    expect(screen.getByRole('menu')).toBeInTheDocument()
    // The tooltip must be immediately hidden when the menu opens

    fireEvent.click(screen.getByRole('button', { name: 'French' }))

    expect(onSelect).toHaveBeenCalled()
  })

  it('keeps translate available and requests languages when its menu first opens', () => {
    const requestTranslationLanguages = vi.fn()
    const context = createActionContext({
      actions: {
        requestTranslationLanguages,
        translateMessage: vi.fn()
      }
    })
    const action = resolveMessageMenuBarToolbarActions(context).find((item) => item.id === 'translate')
    const translationItems = resolveMessageMenuBarTranslationItems(context)

    expect(action).toBeTruthy()
    expect(translationItems).toEqual([
      expect.objectContaining({ key: 'translate-loading', label: 'common.loading', enabled: false })
    ])

    render(
      renderTranslateToolbarAction({
        action: action!,
        actionContext: context,
        executeAction: vi.fn(),
        menuActions: [],
        softHoverBg: false,
        translationItems
      })
    )

    expect(requestTranslationLanguages).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'chat.translate' }))

    expect(requestTranslationLanguages).toHaveBeenCalledOnce()
    expect(screen.getByRole('menu')).toHaveTextContent('common.loading')
  })

  it('offers an actionable retry item when the language load failed, then recovers', async () => {
    const retryTranslationLanguages = vi.fn()
    const failedContext = createActionContext({
      translationLanguagesStatus: 'error',
      actions: {
        requestTranslationLanguages: vi.fn(),
        retryTranslationLanguages,
        translateMessage: vi.fn()
      }
    })

    const failedItems = resolveMessageMenuBarTranslationItems(failedContext)
    expect(failedItems).toEqual([expect.objectContaining({ key: 'translate-retry', label: 'common.retry' })])

    const retryItem = failedItems[0]
    expect('onSelect' in retryItem).toBe(true)
    if ('onSelect' in retryItem) {
      await retryItem.onSelect()
    }
    expect(retryTranslationLanguages).toHaveBeenCalledOnce()

    const recoveredItems = resolveMessageMenuBarTranslationItems(
      createActionContext({
        translationLanguagesStatus: 'ready',
        translateLanguages: [{ langCode: 'en', emoji: '🇺🇸', label: 'English' } as any],
        actions: {
          requestTranslationLanguages: vi.fn(),
          retryTranslationLanguages,
          translateMessage: vi.fn()
        }
      })
    )
    expect(recoveredItems.map((item) => item.key)).toEqual(['en'])
  })

  it('copies the selected assistant path from beside the new branch action', async () => {
    const copyBranchToNewTopic = vi.fn()
    const notifySuccess = vi.fn()
    const context = createActionContext({
      actions: {
        copyBranchToNewTopic,
        notifySuccess,
        startMessageBranch: vi.fn()
      }
    })

    await executeMessageMenuBarAction('copy-to-new-topic', context)

    expect(copyBranchToNewTopic).toHaveBeenCalledWith('message-1')
  })

  it('disables streaming-unsafe toolbar actions while keeping copy enabled', () => {
    const toolbarActions = resolveMessageMenuBarToolbarActions(
      createActionContext({
        actions: {
          deleteMessage: vi.fn(),
          regenerateMessage: vi.fn()
        },
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
      createActionContext({
        actions: { translateMessage },
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
      createActionContext({
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
      createActionContext({
        hasTranslationBlocks: true,
        messageParts: [{ type: 'data-translation', data: { content: 'translated text' } }] as any,
        actions: { copyText: vi.fn(), removeMessageTranslation, notifySuccess }
      })
    )

    const closeItem = translationItems.find((item) => item.key === 'translate-close')
    if (!closeItem || 'type' in closeItem) {
      throw new Error('Expected a translate-close action item')
    }

    await closeItem.onSelect()

    expect(removeMessageTranslation).toHaveBeenCalledWith('message-1')
  })

  it('enables the translate toolbar action as abort while translation is running', () => {
    const toolbarActions = resolveMessageMenuBarToolbarActions(
      createActionContext({
        actions: { abortMessageTranslation: vi.fn() },
        isTranslating: true
      })
    )

    expect(toolbarActions.find((action) => action.id === 'translate')?.availability.enabled).toBe(true)
  })

  it('routes copy through the injected clipboard action', async () => {
    const copyText = vi.fn()
    const setCopied = vi.fn()
    const context = createActionContext({
      actions: { copyText },
      setCopied
    })

    await executeMessageMenuBarAction('copy', context)

    expect(copyText).toHaveBeenCalledWith('hello', { successMessage: 'message.copied' })
    expect(setCopied).toHaveBeenCalledWith(true)
  })

  it('saves the original main text through the local file action', async () => {
    const saveTextFile = vi.fn()
    const context = createActionContext({
      actions: { saveTextFile }
    })

    await executeMessageMenuBarAction('save.file', context)

    expect(saveTextFile).toHaveBeenCalledWith(expect.stringMatching(/\.md$/), 'hello')
  })

  it('keeps copy-as-image source ownership through a queued capture', async () => {
    const currentElement = document.createElement('div')
    const imageBlob = new Blob(['image'], { type: 'image/png' })
    const copyImage = vi.fn()
    const releaseLease = vi.fn()
    const acquireLease = vi.fn(() => releaseLease)
    const captureRef = {
      get current() {
        return currentElement
      }
    }
    const captureScrollableAsBlobMock = vi.mocked(exportService.captureScrollableAsBlob)
    captureScrollableAsBlobMock.mockImplementation(async (ref, callback) => {
      expect(ref.current).toBe(currentElement)
      callback(imageBlob)
    })

    const context = createActionContext({
      actions: { copyImage },
      messageContainerRef: captureRef,
      acquireMessageCaptureLease: acquireLease,
      menuConfig: {
        ...defaultMessageMenuConfig,
        exportMenuOptions: { ...defaultMessageMenuConfig.exportMenuOptions, image: true }
      }
    })

    await expect(executeMessageMenuBarAction('export.copy-image', context)).resolves.toBe(true)

    expect(acquireLease).toHaveBeenCalledWith(context.message.id)
    expect(copyImage).toHaveBeenCalledWith(imageBlob)
    expect(releaseLease).toHaveBeenCalledTimes(1)
  })

  it('reports a queued copy-as-image failure when a topic switch removes its source', async () => {
    const currentElement = document.createElement('div')
    let renderedElement: HTMLElement | null = currentElement
    const copyImage = vi.fn()
    const notifyError = vi.fn()
    const releaseLease = vi.fn()
    const acquireLease = vi.fn(() => releaseLease)
    const getRenderedMessageElement = vi.fn(() => renderedElement)
    let captureQueued!: () => void
    let startQueuedCapture!: () => void
    const captureQueuedPromise = new Promise<void>((resolve) => {
      captureQueued = resolve
    })
    const startQueuedCapturePromise = new Promise<void>((resolve) => {
      startQueuedCapture = resolve
    })
    const captureScrollableAsBlobMock = vi.mocked(exportService.captureScrollableAsBlob)
    captureScrollableAsBlobMock.mockImplementation(async (ref) => {
      captureQueued()
      await startQueuedCapturePromise
      void ref.current
    })

    const context = createActionContext({
      actions: { copyImage, notifyError },
      acquireMessageCaptureLease: acquireLease,
      getRenderedMessageElement,
      menuConfig: {
        ...defaultMessageMenuConfig,
        exportMenuOptions: { ...defaultMessageMenuConfig.exportMenuOptions, image: true }
      }
    })

    const actionPromise = executeMessageMenuBarAction('export.copy-image', context)
    await captureQueuedPromise

    renderedElement = null
    startQueuedCapture()

    await expect(actionPromise).resolves.toBe(false)

    expect(getRenderedMessageElement).toHaveBeenCalledWith(context.message.id)
    expect(copyImage).not.toHaveBeenCalled()
    expect(notifyError).toHaveBeenCalledWith(expect.stringContaining('Message is no longer available'))
    expect(releaseLease).toHaveBeenCalledTimes(1)
  })

  it('keeps save-as-image source ownership through capture failure cleanup', async () => {
    const releaseLease = vi.fn()
    const acquireLease = vi.fn(() => releaseLease)
    const notifyError = vi.fn()
    const captureScrollableAsDataUrlMock = vi.mocked(exportService.captureScrollableAsDataUrl)
    captureScrollableAsDataUrlMock.mockRejectedValue(new Error('capture failed'))

    const context = createActionContext({
      actions: { notifyError, saveImage: vi.fn() },
      acquireMessageCaptureLease: acquireLease,
      menuConfig: {
        ...defaultMessageMenuConfig,
        exportMenuOptions: { ...defaultMessageMenuConfig.exportMenuOptions, image: true }
      }
    })

    await expect(executeMessageMenuBarAction('export.image', context)).resolves.toBe(false)

    expect(acquireLease).toHaveBeenCalledWith(context.message.id)
    expect(releaseLease).toHaveBeenCalledTimes(1)
    expect(getMessageTitle).not.toHaveBeenCalled()
  })

  it('sanitizes the message-derived title before handing it to the save dialog', async () => {
    const saveImage = vi.fn(async () => true)
    const releaseLease = vi.fn()
    const acquireLease = vi.fn(() => releaseLease)
    vi.mocked(exportService.captureScrollableAsDataUrl).mockResolvedValue('data:image/png;base64,AAAA')
    vi.mocked(getMessageTitle).mockResolvedValue('**bold** start: a/b?')

    const context = createActionContext({
      actions: { saveImage },
      acquireMessageCaptureLease: acquireLease,
      menuConfig: {
        ...defaultMessageMenuConfig,
        exportMenuOptions: { ...defaultMessageMenuConfig.exportMenuOptions, image: true }
      }
    })

    await expect(executeMessageMenuBarAction('export.image', context)).resolves.toBe(true)

    expect(saveImage).toHaveBeenCalledWith('__bold__ start_ a_b_', 'data:image/png;base64,AAAA')
    expect(releaseLease).toHaveBeenCalledTimes(1)
  })

  it('copies user composer tokens through rich clipboard when available', async () => {
    const copyText = vi.fn()
    const copyRichContent = vi.fn()
    const setCopied = vi.fn()
    const context = createActionContext({
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
    const context = createActionContext({
      actions: { copyText, notifyError },
      setCopied
    })

    await expect(executeMessageMenuBarAction('copy', context)).resolves.toBe(false)

    expect(notifyError).toHaveBeenCalledWith(expect.stringContaining('clipboard denied'))
    expect(setCopied).not.toHaveBeenCalled()
  })
})
