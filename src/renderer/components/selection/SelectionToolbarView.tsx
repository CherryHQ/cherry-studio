import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check'
import ClipboardCopy from 'lucide-react/dist/esm/icons/clipboard-copy'
import ClipboardX from 'lucide-react/dist/esm/icons/clipboard-x'
import MessageSquareHeart from 'lucide-react/dist/esm/icons/message-square-heart'
import type { FC, Ref } from 'react'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import AppLogo from '@renderer/assets/images/logo.png'
import { cn } from '@renderer/utils/style'
import { SELECTION_BUILTIN_ACTION_ID, type SelectionAction } from '@shared/types/selection'

import SelectionActionIcon from './SelectionActionIcon'

const COPY_ICON_CLASS_NAME = 'absolute inset-0 size-4 transition-[color,opacity,transform] duration-300'

/**
 * ActionIcons is a component that renders the action icons
 */
const ActionIcons: FC<{
  actionItems: SelectionAction[]
  isCompact: boolean
  handleAction: (action: SelectionAction) => void
  copyIconStatus: 'normal' | 'success' | 'fail'
  copyIconAnimation: 'none' | 'enter' | 'exit'
  unavailableReasons?: Partial<Record<string, string>>
}> = memo(({ actionItems, isCompact, handleAction, copyIconStatus, copyIconAnimation, unavailableReasons }) => {
  const { t } = useTranslation()

  const renderCopyIcon = useCallback(() => {
    const shouldShowStatus = copyIconStatus !== 'normal'

    return (
      <>
        <ClipboardCopy
          className={cn(
            'btn-icon',
            COPY_ICON_CLASS_NAME,
            copyIconAnimation === 'enter' && shouldShowStatus && 'scale-0 opacity-0',
            copyIconAnimation !== 'enter' && 'scale-100 opacity-100'
          )}
        />
        {copyIconStatus === 'success' && (
          <ClipboardCheck
            className={cn(
              'btn-icon text-primary',
              COPY_ICON_CLASS_NAME,
              copyIconAnimation === 'enter' && 'scale-100 opacity-100',
              copyIconAnimation !== 'enter' && 'scale-0 opacity-0'
            )}
          />
        )}
        {copyIconStatus === 'fail' && (
          <ClipboardX
            className={cn(
              'btn-icon text-error',
              COPY_ICON_CLASS_NAME,
              copyIconAnimation === 'enter' && 'scale-100 opacity-100',
              copyIconAnimation !== 'enter' && 'scale-0 opacity-0'
            )}
          />
        )}
      </>
    )
  }, [copyIconAnimation, copyIconStatus])

  const renderActionButton = useCallback(
    (action: SelectionAction) => {
      const displayName = action.isBuiltIn ? t(action.name) : action.name
      const unavailableReason = unavailableReasons?.[action.id]

      return (
        <button
          type="button"
          key={action.id}
          onClick={unavailableReason ? undefined : () => handleAction(action)}
          title={isCompact ? displayName : undefined}
          aria-label={displayName}
          aria-disabled={unavailableReason ? true : undefined}
          aria-description={unavailableReason}
          className={cn(
            'group m-0 flex h-full cursor-pointer! flex-row items-center justify-center gap-0.5 rounded-none border-0 bg-transparent px-2 py-0 shadow-none transition-colors duration-100 [-webkit-app-region:no-drag]',
            'last:rounded-r-[10px] last:py-0 last:pr-3 last:pl-2',
            unavailableReason ? 'cursor-default!' : 'hover:bg-accent'
          )}>
          <span
            className={cn(
              'relative flex size-4 items-center justify-center bg-transparent',
              unavailableReason
                ? '[&_svg]:text-foreground-disabled'
                : ['[&_svg]:text-card-foreground', 'group-hover:[&_svg]:text-primary']
            )}>
            {action.isBuiltIn && action.id === SELECTION_BUILTIN_ACTION_ID.COPY ? (
              renderCopyIcon()
            ) : (
              <SelectionActionIcon
                name={action.icon}
                className="btn-icon absolute inset-0 size-full bg-transparent transition-colors duration-100"
                fallback={() => (
                  <MessageSquareHeart className="btn-icon absolute inset-0 size-full bg-transparent transition-colors duration-100" />
                )}
              />
            )}
            {unavailableReason && isCompact && (
              <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-warning" />
            )}
          </span>
          {!isCompact &&
            (unavailableReason ? (
              // The toolbar window keeps its width while shown, so both labels share one cell sized to the longer.
              <span className="btn-title m-0 grid max-w-[120px] bg-transparent text-sm leading-[1.1] whitespace-nowrap">
                <span className="[grid-area:1/1] overflow-hidden text-ellipsis text-foreground-disabled group-hover:invisible">
                  {displayName}
                </span>
                <span className="invisible [grid-area:1/1] overflow-hidden text-ellipsis text-warning group-hover:visible">
                  {unavailableReason}
                </span>
              </span>
            ) : (
              <span
                className={cn(
                  'btn-title m-0 max-w-[120px] overflow-hidden bg-transparent text-sm leading-[1.1] text-ellipsis whitespace-nowrap text-card-foreground transition-colors duration-100',
                  'group-hover:text-primary'
                )}>
                {displayName}
              </span>
            ))}
        </button>
      )
    },
    [handleAction, isCompact, t, renderCopyIcon, unavailableReasons]
  )

  return <>{actionItems?.map(renderActionButton)}</>
})

interface SelectionToolbarViewProps {
  actionItems: SelectionAction[]
  isCompact: boolean
  handleAction: (action: SelectionAction) => void
  copyIconStatus: 'normal' | 'success' | 'fail'
  copyIconAnimation: 'none' | 'enter' | 'exit'
  /** Localized reasons keyed by action id; those actions render disabled. */
  unavailableReasons?: Partial<Record<string, string>>
  /**
   * Whether the logo carries the OS `[-webkit-app-region:drag]` region. The
   * real toolbar window needs it to move the frameless window; the settings
   * preview must NOT be draggable, so it omits this (defaults to false).
   */
  draggable?: boolean
  ref?: Ref<HTMLDivElement>
}

/**
 * SelectionToolbarView is the presentational chrome of the selection toolbar,
 * shared by the toolbar window and the settings preview. It is stateless: all
 * preference reads, IPC, copy-icon state, and window-size reporting live in the
 * caller and are threaded in via props.
 */
const SelectionToolbarView = ({
  actionItems,
  isCompact,
  handleAction,
  copyIconStatus,
  copyIconAnimation,
  unavailableReasons,
  draggable = false,
  ref
}: SelectionToolbarViewProps) => {
  return (
    <div
      data-ui="selection.toolbar"
      ref={ref}
      className={cn(
        'm-[2px_3px_5px_3px]! box-border inline-flex h-9 flex-row items-stretch overflow-hidden rounded-[10px] border-0 bg-card p-0! font-[var(--font-family-body)] select-none',
        'shadow-[var(--selection-toolbar-shadow)] [--selection-toolbar-border:rgb(0_0_0_/_0.08)] [--selection-toolbar-shadow:0_2px_3px_rgb(50_50_50_/_0.1)]',
        'dark:[--selection-toolbar-border:rgb(255_255_255_/_0.2)] dark:[--selection-toolbar-shadow:0_2px_3px_rgb(50_50_50_/_0.3)]'
      )}>
      <div
        className={cn(
          'm-0 flex items-center justify-center rounded-l-[10px] [border-width:0.5px_0_0.5px_0.5px] border-solid border-[var(--selection-toolbar-border)] bg-transparent [padding:0_6px_0_8px]',
          draggable && '[-webkit-app-region:drag]'
        )}>
        <img src={AppLogo} className="size-[22px] rounded-full object-cover" draggable={false} alt="" />
      </div>
      <div
        className={cn(
          'flex flex-row items-center justify-center bg-transparent [-webkit-app-region:no-drag]',
          'rounded-[0_10px_10px_0] [border-width:0.5px_0.5px_0.5px_0] border-solid border-[var(--selection-toolbar-border)]'
        )}>
        <ActionIcons
          actionItems={actionItems}
          isCompact={isCompact}
          handleAction={handleAction}
          copyIconStatus={copyIconStatus}
          copyIconAnimation={copyIconAnimation}
          unavailableReasons={unavailableReasons}
        />
      </div>
    </div>
  )
}

export default SelectionToolbarView
