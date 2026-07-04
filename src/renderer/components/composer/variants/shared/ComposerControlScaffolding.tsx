import { ComposerActiveToolControls, ComposerToolMenu } from '@renderer/components/composer/ComposerToolRuntime'
import type { ComposerUnifiedPanelControl } from '@renderer/components/composer/quickPanel'
import type { QuickPanelInputAdapter } from '@renderer/components/QuickPanel'
import { cn } from '@renderer/utils/style'
import type { ReactNode } from 'react'

import { useComposerBottomToolbarIconOnly } from '../useComposerBottomToolbarIconOnly'

export const COMPOSER_TOOLBAR_CLASS = 'flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden'
export const COMPOSER_SELECTOR_BUTTON_CLASS = 'h-7 shrink-0 gap-1.5 rounded-full px-2 text-xs'
export const COMPOSER_BELOW_SELECTOR_BUTTON_CLASS =
  'h-8 shrink-0 gap-1.5 rounded-lg border border-transparent bg-transparent px-2.5 text-xs font-medium text-foreground/85 shadow-none hover:bg-accent hover:text-foreground active:bg-accent disabled:bg-transparent disabled:text-muted-foreground/50 [&_svg]:text-foreground/70 hover:[&_svg]:text-foreground'
export const COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS = 'w-8 justify-center px-0'
export const COMPOSER_ICON_ONLY_LABEL_CLASS = 'sr-only'

type RenderContextControls = (args: { side: 'top' | 'bottom'; iconOnly: boolean }) => ReactNode

/** The shared "+" tool menu plus the active-tool controls rendered on the composer's left. */
export const ComposerToolMenuControls = ({
  inputAdapter,
  unifiedPanelControl
}: {
  inputAdapter?: QuickPanelInputAdapter
  unifiedPanelControl?: ComposerUnifiedPanelControl
}) => {
  return (
    <>
      <ComposerToolMenu inputAdapter={inputAdapter} unifiedPanelControl={unifiedPanelControl} />
      <ComposerActiveToolControls inputAdapter={inputAdapter} />
    </>
  )
}

/** Toolbar (top) layout: variant-specific context controls + the shared tool menu. */
export const ComposerToolbarControls = ({
  inputAdapter,
  renderContextControls,
  unifiedPanelControl,
  toolMenuPlacement = 'afterContext'
}: {
  inputAdapter?: QuickPanelInputAdapter
  renderContextControls: RenderContextControls
  unifiedPanelControl?: ComposerUnifiedPanelControl
  toolMenuPlacement?: 'beforeContext' | 'afterContext'
}) => {
  const { iconOnly, toolbarRef } = useComposerBottomToolbarIconOnly()
  const contextControls = renderContextControls({ side: 'top', iconOnly })

  if (toolMenuPlacement === 'beforeContext') {
    return (
      <div ref={toolbarRef} className={cn(COMPOSER_TOOLBAR_CLASS, 'w-full')}>
        <ComposerToolMenuControls inputAdapter={inputAdapter} unifiedPanelControl={unifiedPanelControl} />
        {contextControls}
      </div>
    )
  }

  return (
    <div ref={toolbarRef} className={cn(COMPOSER_TOOLBAR_CLASS, 'w-full')}>
      {contextControls}
      <ComposerToolMenuControls inputAdapter={inputAdapter} unifiedPanelControl={unifiedPanelControl} />
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
