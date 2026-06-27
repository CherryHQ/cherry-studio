import { Tooltip } from '@cherrystudio/ui'
import { ComposerActiveToolControls, ComposerToolMenu } from '@renderer/components/composer/ComposerToolRuntime'
import type { QuickPanelInputAdapter } from '@renderer/components/QuickPanel'
import { cn } from '@renderer/utils/style'
import { MessageSquarePlus } from 'lucide-react'
import type { ReactNode } from 'react'

import { useComposerBottomToolbarIconOnly } from '../useComposerBottomToolbarIconOnly'

export const COMPOSER_TOOLBAR_CLASS = 'flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden'
export const COMPOSER_SELECTOR_BUTTON_CLASS = 'h-7 shrink-0 gap-1.5 rounded-full px-2 text-xs'
export const COMPOSER_BELOW_SELECTOR_BUTTON_CLASS =
  'h-8 shrink-0 gap-1.5 rounded-lg border border-transparent bg-transparent px-2.5 text-xs font-medium text-foreground/85 shadow-none hover:bg-accent hover:text-foreground active:bg-accent disabled:bg-transparent disabled:text-muted-foreground/50 [&_svg]:text-foreground/70 hover:[&_svg]:text-foreground'
export const COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS = 'w-8 justify-center px-0'
export const COMPOSER_ICON_ONLY_LABEL_CLASS = 'sr-only'

type RenderContextControls = (args: { side: 'top' | 'bottom'; iconOnly: boolean }) => ReactNode
export type ComposerNewConversationAction = {
  label: string
  disabled?: boolean
  onClick: () => void | Promise<void>
}

const COMPOSER_CIRCLE_TOOL_BUTTON_CLASS =
  'flex size-[30px] shrink-0 items-center justify-center rounded-full text-foreground-secondary transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-foreground-secondary'

const ComposerNewConversationButton = ({ action }: { action: ComposerNewConversationAction }) => (
  <Tooltip content={action.label}>
    <button
      type="button"
      className={COMPOSER_CIRCLE_TOOL_BUTTON_CLASS}
      aria-label={action.label}
      disabled={action.disabled}
      onClick={() => {
        void action.onClick()
      }}>
      <MessageSquarePlus size={18} />
    </button>
  </Tooltip>
)

/** The shared "+" tool menu plus the active-tool controls rendered on the composer's left. */
export const ComposerToolMenuControls = ({
  inputAdapter,
  newConversationAction
}: {
  inputAdapter?: QuickPanelInputAdapter
  newConversationAction?: ComposerNewConversationAction
}) => {
  return (
    <>
      {newConversationAction ? <ComposerNewConversationButton action={newConversationAction} /> : null}
      <ComposerToolMenu inputAdapter={inputAdapter} />
      <ComposerActiveToolControls inputAdapter={inputAdapter} />
    </>
  )
}

/** Toolbar (top) layout: tool menu + the variant-specific context controls. */
export const ComposerToolbarControls = ({
  inputAdapter,
  newConversationAction,
  renderContextControls
}: {
  inputAdapter?: QuickPanelInputAdapter
  newConversationAction?: ComposerNewConversationAction
  renderContextControls: RenderContextControls
}) => {
  const { iconOnly, toolbarRef } = useComposerBottomToolbarIconOnly()
  const contextControls = renderContextControls({ side: 'top', iconOnly })

  if (newConversationAction) {
    return (
      <div ref={toolbarRef} className={cn(COMPOSER_TOOLBAR_CLASS, 'w-full')}>
        <ComposerNewConversationButton action={newConversationAction} />
        {contextControls}
        <ComposerToolMenuControls inputAdapter={inputAdapter} />
      </div>
    )
  }

  return (
    <div ref={toolbarRef} className={cn(COMPOSER_TOOLBAR_CLASS, 'w-full')}>
      <ComposerToolMenuControls inputAdapter={inputAdapter} />
      {contextControls}
    </div>
  )
}

/** Below-surface (bottom) layout: variant context controls plus an optional trailing slot. */
export const ComposerBelowControls = ({
  renderContextControls,
  trailing
}: {
  renderContextControls: RenderContextControls
  trailing?: (args: { iconOnly: boolean }) => ReactNode
}) => {
  const { iconOnly, toolbarRef } = useComposerBottomToolbarIconOnly()

  return (
    <div ref={toolbarRef} className={cn(COMPOSER_TOOLBAR_CLASS, 'w-full')}>
      {renderContextControls({ side: 'bottom', iconOnly })}
      {trailing ? <div className="ml-auto flex shrink-0">{trailing({ iconOnly })}</div> : null}
    </div>
  )
}
