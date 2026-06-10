import { ComposerActiveToolControls, ComposerToolMenu } from '@renderer/components/chat/composer/ComposerToolRuntime'
import type { QuickPanelInputAdapter } from '@renderer/components/QuickPanel'
import { cn } from '@renderer/utils'
import type { ReactNode } from 'react'

import { useComposerBottomToolbarIconOnly } from '../useComposerBottomToolbarIconOnly'

export const COMPOSER_TOOLBAR_CLASS = 'flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden'
export const COMPOSER_SELECTOR_BUTTON_CLASS = 'h-7 shrink-0 gap-1.5 rounded-full px-2 text-xs'
export const COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS = 'w-8 justify-center px-0'
export const COMPOSER_ICON_ONLY_LABEL_CLASS = 'sr-only'

type RenderContextControls = (args: { side: 'top' | 'bottom'; iconOnly: boolean }) => ReactNode

/** The shared "+" tool menu plus the active-tool controls rendered on the composer's left. */
export const ComposerToolMenuControls = ({ inputAdapter }: { inputAdapter?: QuickPanelInputAdapter }) => {
  return (
    <>
      <ComposerToolMenu inputAdapter={inputAdapter} />
      <ComposerActiveToolControls inputAdapter={inputAdapter} />
    </>
  )
}

/** Toolbar (top) layout: tool menu + the variant-specific context controls. */
export const ComposerToolbarControls = ({
  inputAdapter,
  renderContextControls
}: {
  inputAdapter?: QuickPanelInputAdapter
  renderContextControls: RenderContextControls
}) => {
  const { iconOnly, toolbarRef } = useComposerBottomToolbarIconOnly()

  return (
    <div ref={toolbarRef} className={cn(COMPOSER_TOOLBAR_CLASS, 'w-full')}>
      <ComposerToolMenuControls inputAdapter={inputAdapter} />
      {renderContextControls({ side: 'top', iconOnly })}
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
