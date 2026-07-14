import { ComposerActiveToolControls, ComposerToolMenu } from '@renderer/components/composer/ComposerToolRuntime'
import type { ComposerUnifiedPanelControl } from '@renderer/components/composer/quickPanel'
import type { QuickPanelInputAdapter } from '@renderer/components/QuickPanel'
import { useOverflowIconOnly } from '@renderer/hooks/useOverflowIconOnly'
import { cn } from '@renderer/utils/style'
import type { ReactNode } from 'react'

export const COMPOSER_TOOLBAR_CLASS = 'flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden'
export const COMPOSER_SELECTOR_BUTTON_CLASS = 'h-7 shrink-0 gap-1.5 rounded-full px-2 text-xs'
export const COMPOSER_BELOW_SELECTOR_BUTTON_CLASS =
  'h-8 shrink-0 gap-1.5 rounded-lg border border-transparent bg-transparent px-2.5 text-xs font-medium text-foreground/85 shadow-none hover:bg-accent hover:text-foreground active:bg-accent disabled:bg-transparent disabled:text-muted-foreground/50 [&_svg]:text-foreground/70 hover:[&_svg]:text-foreground'
export const COMPOSER_SEND_ACCESSORY_BUTTON_CLASS =
  'size-7.5 shrink-0 rounded-full text-foreground/70! duration-150 ease-in-out hover:bg-accent/60 hover:text-foreground! data-[active=true]:bg-accent data-[active=true]:text-primary! data-[active=true]:hover:text-primary! [&_.lucide:not(.lucide-custom)]:text-current! [&_svg]:!size-[18px]'
export const COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS = 'w-8 justify-center px-0'
export const COMPOSER_ICON_ONLY_LABEL_CLASS = 'sr-only'

type RenderContextControls = (args: { side: 'top' | 'bottom'; iconOnly: boolean }) => ReactNode

/** The shared "+" tool menu plus the active-tool controls rendered on the composer's left. */
export const ComposerToolMenuControls = ({
  inputAdapter,
  unifiedPanelControl,
  showToolMenu = true
}: {
  inputAdapter?: QuickPanelInputAdapter
  unifiedPanelControl?: ComposerUnifiedPanelControl
  showToolMenu?: boolean
}) => {
  return (
    <>
      {showToolMenu ? <ComposerToolMenu inputAdapter={inputAdapter} unifiedPanelControl={unifiedPanelControl} /> : null}
      <ComposerActiveToolControls inputAdapter={inputAdapter} />
    </>
  )
}

export const ComposerToolMenuButton = ({
  inputAdapter,
  unifiedPanelControl
}: {
  inputAdapter?: QuickPanelInputAdapter
  unifiedPanelControl?: ComposerUnifiedPanelControl
}) => {
  return <ComposerToolMenu inputAdapter={inputAdapter} unifiedPanelControl={unifiedPanelControl} />
}

/** Toolbar (top) layout: variant-specific context controls + the shared tool menu. */
export const ComposerToolbarControls = ({
  inputAdapter,
  renderContextControls,
  unifiedPanelControl,
  toolMenuPlacement = 'afterContext',
  leading,
  showToolMenu = true
}: {
  inputAdapter?: QuickPanelInputAdapter
  renderContextControls: RenderContextControls
  unifiedPanelControl?: ComposerUnifiedPanelControl
  toolMenuPlacement?: 'beforeContext' | 'afterContext'
  leading?: ReactNode
  showToolMenu?: boolean
}) => {
  const { iconOnly, containerRef: toolbarRef } = useOverflowIconOnly()
  const contextControls = renderContextControls({ side: 'top', iconOnly })

  if (toolMenuPlacement === 'beforeContext') {
    return (
      <div ref={toolbarRef} className={cn(COMPOSER_TOOLBAR_CLASS, 'w-full')}>
        {leading}
        <ComposerToolMenuControls
          inputAdapter={inputAdapter}
          unifiedPanelControl={unifiedPanelControl}
          showToolMenu={showToolMenu}
        />
        {contextControls}
      </div>
    )
  }

  return (
    <div ref={toolbarRef} className={cn(COMPOSER_TOOLBAR_CLASS, 'w-full')}>
      {leading}
      {contextControls}
      <ComposerToolMenuControls
        inputAdapter={inputAdapter}
        unifiedPanelControl={unifiedPanelControl}
        showToolMenu={showToolMenu}
      />
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
  const { iconOnly, containerRef: toolbarRef } = useOverflowIconOnly()

  return (
    <div ref={toolbarRef} className={cn(COMPOSER_TOOLBAR_CLASS, 'w-full')}>
      {renderContextControls({ side: 'bottom', iconOnly })}
      {trailing ? <div className="ml-auto flex shrink-0">{trailing({ iconOnly })}</div> : null}
    </div>
  )
}
