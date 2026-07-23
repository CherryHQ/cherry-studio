import AppLogo from '@renderer/assets/images/logo.png'
import { cn } from '@renderer/utils/style'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check'
import ClipboardCopy from 'lucide-react/dist/esm/icons/clipboard-copy'
import ClipboardX from 'lucide-react/dist/esm/icons/clipboard-x'
import MessageSquareHeart from 'lucide-react/dist/esm/icons/message-square-heart'
import type { FC, Ref } from 'react'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import SelectionActionIcon from './SelectionActionIcon'

const COPY_ICON_CLASS_NAME = 'absolute inset-0 size-4 transition-[color,opacity,transform] duration-300'

/**
 * ActionIcons is a component that renders the action icons
 */
const ActionIcons: FC<{
  actionItems: SelectionActionItem[]
  isCompact: boolean
  handleAction: (action: SelectionActionItem) => void
  copyIconStatus: 'normal' | 'success' | 'fail'
  copyIconAnimation: 'none' | 'enter' | 'exit'
}> = memo(({ actionItems, isCompact, handleAction, copyIconStatus, copyIconAnimation }) => {
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
              'btn-icon text-error-base',
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
    (action: SelectionActionItem) => {
      const displayName = action.isBuiltIn ? t(action.name) : action.name

      return (
        <button
          type="button"
          key={action.id}
          onClick={() => handleAction(action)}
          title={isCompact ? displayName : undefined}
          aria-label={displayName}
          className={cn(
            'group m-0 flex h-full cursor-pointer! flex-row items-center justify-center gap-0.5 rounded-none border-0 bg-transparent px-2 py-0 shadow-none transition-colors duration-100 [-webkit-app-region:no-drag]',
            'last:rounded-r-[10px] last:py-0 last:pr-3 last:pl-2',
            'hover:bg-black/[0.04] dark:hover:bg-[#333333]'
          )}>
          <span
            className={cn(
              'relative flex size-4 items-center justify-center bg-transparent',
              '[&_svg]:text-black dark:[&_svg]:text-[rgb(255_255_245_/_0.9)]',
              'group-hover:[&_svg]:text-primary'
            )}>
            {action.id === 'copy' ? (
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
          </span>
          {!isCompact && (
            <span
              className={cn(
                'btn-title m-0 max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap bg-transparent text-black text-sm leading-[1.1] transition-colors duration-100 dark:text-[rgb(255_255_245_/_0.9)]',
                'group-hover:text-primary'
              )}>
              {displayName}
            </span>
          )}
        </button>
      )
    },
    [handleAction, isCompact, t, renderCopyIcon]
  )

  return <>{actionItems?.map(renderActionButton)}</>
})

interface SelectionToolbarViewProps {
  actionItems: SelectionActionItem[]
  isCompact: boolean
  handleAction: (action: SelectionActionItem) => void
  copyIconStatus: 'normal' | 'success' | 'fail'
  copyIconAnimation: 'none' | 'enter' | 'exit'
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
  draggable = false,
  ref
}: SelectionToolbarViewProps) => {
  return (
    <div
      ref={ref}
      className={cn(
        'm-[2px_3px_5px_3px]! box-border inline-flex h-9 select-none flex-row items-stretch overflow-hidden rounded-[10px] border-0 bg-card p-0! font-[var(--font-family-body)] shadow-[0_2px_3px_rgb(50_50_50_/_0.1)]',
        'dark:shadow-[0_2px_3px_rgb(50_50_50_/_0.3)]'
      )}>
      <div
        className={cn(
          'm-0 flex items-center justify-center rounded-l-[10px] border-[rgb(0_0_0_/_0.08)] border-solid bg-transparent [border-width:0.5px_0_0.5px_0.5px] [padding:0_6px_0_8px]',
          'dark:border-[rgb(255_255_255_/_0.2)]',
          draggable && '[-webkit-app-region:drag]'
        )}>
        <img src={AppLogo} className="size-[22px] rounded-full object-cover" draggable={false} alt="" />
      </div>
      <div
        className={cn(
          'flex flex-row items-center justify-center bg-transparent [-webkit-app-region:no-drag]',
          'rounded-[0_10px_10px_0] border-[rgb(0_0_0_/_0.08)] border-solid [border-width:0.5px_0.5px_0.5px_0]',
          'dark:border-[rgb(255_255_255_/_0.2)]'
        )}>
        <ActionIcons
          actionItems={actionItems}
          isCompact={isCompact}
          handleAction={handleAction}
          copyIconStatus={copyIconStatus}
          copyIconAnimation={copyIconAnimation}
        />
      </div>
    </div>
  )
}

export default SelectionToolbarView
