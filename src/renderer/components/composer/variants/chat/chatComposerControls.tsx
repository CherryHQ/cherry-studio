import React, { useCallback } from 'react'

import { ConversationTopBarPortal } from '@renderer/components/chat/shell/ConversationTopBarPortal'
import type ComposerSurface from '@renderer/components/composer/ComposerSurface'

import {
  COMPOSER_TOOLBAR_CLASS,
  ComposerBelowControls,
  ComposerToolbarControls,
  ComposerToolMenuControls
} from '../shared/ComposerControlScaffolding'
import { ChatConversationControls, type ChatConversationControlsProps } from './ChatConversationControls'

type ChatComposerControlProps = Omit<ChatConversationControlsProps, 'side'> & {
  topBarPortalAvailable: boolean
  topBarPortalIconOnly: boolean
  leadingControl?: React.ReactNode
  renderPersistentToolShortcuts?: (args: {
    inputAdapter?: ComposerInputAdapter
    unifiedPanelControl?: ComposerUnifiedPanelControl
  }) => React.ReactNode
}

type ComposerSurfaceProps = React.ComponentProps<typeof ComposerSurface>
export type ComposerInputAdapter = Parameters<NonNullable<ComposerSurfaceProps['renderLeftControls']>>[0]
export type ComposerUnifiedPanelControl = Parameters<NonNullable<ComposerSurfaceProps['renderLeftControls']>>[1]
type ChatComposerControlSlots = Pick<
  ComposerSurfaceProps,
  'renderLeftControls' | 'renderBelowControls' | 'renderCompactControls'
>
export type ChatComposerControlsRenderer = (props: ChatComposerControlProps) => ChatComposerControlSlots

const renderChatPersistentCompactControls = (
  props: ChatComposerControlProps,
  inputAdapter: ComposerInputAdapter,
  unifiedPanelControl: ComposerUnifiedPanelControl
) => props.renderPersistentToolShortcuts?.({ inputAdapter, unifiedPanelControl })

const restoreComposerInputFocus = (inputAdapter: ComposerInputAdapter) => {
  window.requestAnimationFrame(() => inputAdapter?.focus())
}

const ChatComposerContextControlsWithAutoFocus = ({
  inputAdapter,
  ...props
}: ChatComposerControlProps & { side: 'top' | 'bottom'; iconOnly?: boolean; inputAdapter: ComposerInputAdapter }) => {
  const onDialogCloseAutoFocus = useCallback(() => restoreComposerInputFocus(inputAdapter), [inputAdapter])

  return <ChatConversationControls {...props} onDialogCloseAutoFocus={onDialogCloseAutoFocus} />
}

const renderChatComposerContextControls = (
  props: ChatComposerControlProps,
  inputAdapter: ComposerInputAdapter,
  { side, iconOnly }: { side: 'top' | 'bottom'; iconOnly: boolean }
) => {
  const controls = (
    <ChatComposerContextControlsWithAutoFocus
      {...props}
      side={props.topBarPortalAvailable ? 'bottom' : side}
      iconOnly={props.topBarPortalAvailable ? props.topBarPortalIconOnly : iconOnly}
      inputAdapter={inputAdapter}
    />
  )

  return props.topBarPortalAvailable ? <ConversationTopBarPortal>{controls}</ConversationTopBarPortal> : controls
}

export const renderChatToolbarControls: ChatComposerControlsRenderer = (props) => ({
  renderLeftControls: (inputAdapter, unifiedPanelControl) => {
    const persistentToolShortcuts = props.renderPersistentToolShortcuts?.({ inputAdapter, unifiedPanelControl })

    return (
      <ComposerToolbarControls
        inputAdapter={inputAdapter}
        leading={
          <>
            {props.leadingControl}
            {persistentToolShortcuts}
          </>
        }
        unifiedPanelControl={unifiedPanelControl}
        renderContextControls={(placement) => renderChatComposerContextControls(props, inputAdapter, placement)}
      />
    )
  }
})

export const renderChatInputControls: ChatComposerControlsRenderer = (props) => ({
  renderLeftControls: (inputAdapter, unifiedPanelControl) => (
    <ComposerToolbarControls
      inputAdapter={inputAdapter}
      leading={
        <>
          {props.leadingControl}
          {props.renderPersistentToolShortcuts?.({ inputAdapter, unifiedPanelControl })}
        </>
      }
      unifiedPanelControl={unifiedPanelControl}
      renderContextControls={() => null}
    />
  ),
  renderCompactControls: (inputAdapter, unifiedPanelControl) =>
    renderChatPersistentCompactControls(props, inputAdapter, unifiedPanelControl)
})

export const renderChatHomeControls: ChatComposerControlsRenderer = (props) => ({
  renderLeftControls: (inputAdapter, unifiedPanelControl) => {
    const persistentToolShortcuts = props.renderPersistentToolShortcuts?.({ inputAdapter, unifiedPanelControl })

    return (
      <>
        {props.topBarPortalAvailable
          ? renderChatComposerContextControls(props, inputAdapter, { side: 'bottom', iconOnly: false })
          : null}
        <div className={COMPOSER_TOOLBAR_CLASS}>
          {props.leadingControl}
          {persistentToolShortcuts}
          <ComposerToolMenuControls inputAdapter={inputAdapter} unifiedPanelControl={unifiedPanelControl} />
        </div>
      </>
    )
  },
  renderBelowControls: props.topBarPortalAvailable
    ? undefined
    : (inputAdapter) => (
        <ComposerBelowControls
          renderContextControls={(placement) =>
            renderChatComposerContextControls({ ...props, useMentionedModelSelector: true }, inputAdapter, placement)
          }
        />
      )
})

export const renderChatHomeInputControls: ChatComposerControlsRenderer = (props) => ({
  renderLeftControls: (inputAdapter, unifiedPanelControl) => (
    <div className={COMPOSER_TOOLBAR_CLASS}>
      {props.leadingControl}
      {props.renderPersistentToolShortcuts?.({ inputAdapter, unifiedPanelControl })}
      <ComposerToolMenuControls inputAdapter={inputAdapter} unifiedPanelControl={unifiedPanelControl} />
    </div>
  ),
  renderCompactControls: (inputAdapter, unifiedPanelControl) =>
    renderChatPersistentCompactControls(props, inputAdapter, unifiedPanelControl)
})
