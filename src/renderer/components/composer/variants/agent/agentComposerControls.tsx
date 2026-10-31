import React, { useCallback } from 'react'

import { ConversationTopBarPortal } from '@renderer/components/chat/shell/ConversationTopBarPortal'
import type ComposerSurface from '@renderer/components/composer/ComposerSurface'

import {
  COMPOSER_TOOLBAR_CLASS,
  ComposerBelowControls,
  ComposerToolbarControls,
  ComposerToolMenuControls
} from '../shared/ComposerControlScaffolding'
import { AgentConversationControls, type AgentConversationControlsProps } from './AgentConversationControls'

type AgentComposerControlProps = Omit<
  AgentConversationControlsProps,
  'side' | 'iconOnly' | 'onAgentDialogCloseAutoFocus'
> & {
  topBarPortalAvailable: boolean
  topBarPortalIconOnly: boolean
  leadingControl?: React.ReactNode
  renderQuickPanelShortcuts?: (args: {
    inputAdapter?: AgentComposerInputAdapter
    unifiedPanelControl?: AgentComposerUnifiedPanelControl
  }) => React.ReactNode
}
type ComposerSurfaceProps = React.ComponentProps<typeof ComposerSurface>
type AgentComposerControlSlots = Pick<
  ComposerSurfaceProps,
  'renderLeftControls' | 'renderBelowControls' | 'renderCompactControls'
>
export type AgentComposerControlsRenderer = (props: AgentComposerControlProps) => AgentComposerControlSlots

export type AgentComposerInputAdapter = Parameters<NonNullable<ComposerSurfaceProps['renderLeftControls']>>[0]
export type AgentComposerUnifiedPanelControl = Parameters<NonNullable<ComposerSurfaceProps['renderLeftControls']>>[1]

const restoreAgentComposerInputFocus = (inputAdapter: AgentComposerInputAdapter) => {
  window.requestAnimationFrame(() => inputAdapter?.focus())
}

const AgentConversationControlsWithAutoFocus = ({
  inputAdapter,
  ...props
}: AgentConversationControlsProps & { inputAdapter: AgentComposerInputAdapter }) => {
  const onAgentDialogCloseAutoFocus = useCallback(() => restoreAgentComposerInputFocus(inputAdapter), [inputAdapter])

  return <AgentConversationControls {...props} onAgentDialogCloseAutoFocus={onAgentDialogCloseAutoFocus} />
}

const renderAgentComposerContextControls = (
  props: AgentComposerControlProps,
  inputAdapter: AgentComposerInputAdapter,
  { side, iconOnly }: { side: 'top' | 'bottom'; iconOnly: boolean }
) => {
  const resolvedSide = props.topBarPortalAvailable ? 'bottom' : side
  const resolvedIconOnly = props.topBarPortalAvailable ? props.topBarPortalIconOnly : iconOnly
  const controls = (
    <AgentConversationControlsWithAutoFocus
      {...props}
      side={resolvedSide}
      iconOnly={resolvedIconOnly}
      inputAdapter={inputAdapter}
    />
  )

  return props.topBarPortalAvailable ? <ConversationTopBarPortal>{controls}</ConversationTopBarPortal> : controls
}

export const renderAgentToolbarControls: AgentComposerControlsRenderer = (props) => {
  return {
    renderLeftControls: (inputAdapter, unifiedPanelControl) => {
      const quickPanelShortcuts = props.renderQuickPanelShortcuts?.({ inputAdapter, unifiedPanelControl })

      return (
        <ComposerToolbarControls
          inputAdapter={inputAdapter}
          leading={
            <>
              {props.leadingControl}
              {quickPanelShortcuts}
            </>
          }
          unifiedPanelControl={unifiedPanelControl}
          renderContextControls={({ side, iconOnly }) =>
            renderAgentComposerContextControls(props, inputAdapter, { side, iconOnly })
          }
        />
      )
    },
    renderCompactControls: (inputAdapter, unifiedPanelControl) => (
      <>
        {props.topBarPortalAvailable
          ? renderAgentComposerContextControls(props, inputAdapter, {
              side: 'bottom',
              iconOnly: props.topBarPortalIconOnly
            })
          : null}
        {props.renderQuickPanelShortcuts?.({ inputAdapter, unifiedPanelControl })}
      </>
    )
  }
}

export const renderAgentInputControls: AgentComposerControlsRenderer = (props) => {
  return {
    renderLeftControls: (inputAdapter, unifiedPanelControl) => (
      <ComposerToolbarControls
        inputAdapter={inputAdapter}
        leading={
          <>
            {props.leadingControl}
            {props.renderQuickPanelShortcuts?.({ inputAdapter, unifiedPanelControl })}
          </>
        }
        unifiedPanelControl={unifiedPanelControl}
        renderContextControls={() => null}
      />
    ),
    renderCompactControls: (inputAdapter, unifiedPanelControl) =>
      props.renderQuickPanelShortcuts?.({ inputAdapter, unifiedPanelControl })
  }
}

export const renderAgentHomeControls: AgentComposerControlsRenderer = (props) => {
  return {
    renderLeftControls: (inputAdapter, unifiedPanelControl) => {
      const quickPanelShortcuts = props.renderQuickPanelShortcuts?.({ inputAdapter, unifiedPanelControl })

      return (
        <>
          {props.topBarPortalAvailable
            ? renderAgentComposerContextControls(props, inputAdapter, {
                side: 'bottom',
                iconOnly: false
              })
            : null}
          <div className={COMPOSER_TOOLBAR_CLASS}>
            {props.leadingControl}
            {quickPanelShortcuts}
            <ComposerToolMenuControls inputAdapter={inputAdapter} unifiedPanelControl={unifiedPanelControl} />
          </div>
        </>
      )
    },
    renderBelowControls: props.topBarPortalAvailable
      ? undefined
      : (inputAdapter) => (
          <ComposerBelowControls
            renderContextControls={({ side, iconOnly }) =>
              renderAgentComposerContextControls(props, inputAdapter, { side, iconOnly })
            }
          />
        )
  }
}
