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

  const copyBaseClassName = cn(
    'absolute inset-0 transition-[color,opacity,transform] duration-300',
    '[height:var(--selection-toolbar-button-icon-size,16px)]',
    '[width:var(--selection-toolbar-button-icon-size,16px)]'
  )

  const renderCopyIcon = useCallback(() => {
    const shouldShowStatus = copyIconStatus !== 'normal'

    return (
      <>
        <ClipboardCopy
          className={cn(
            'btn-icon',
            copyBaseClassName,
            copyIconAnimation === 'enter' && shouldShowStatus && 'scale-0 opacity-0',
            copyIconAnimation !== 'enter' && 'scale-100 opacity-100'
          )}
        />
        {copyIconStatus === 'success' && (
          <ClipboardCheck
            className={cn(
              'btn-icon text-primary',
              copyBaseClassName,
              copyIconAnimation === 'enter' && 'scale-100 opacity-100',
              copyIconAnimation !== 'enter' && 'scale-0 opacity-0'
            )}
          />
        )}
        {copyIconStatus === 'fail' && (
          <ClipboardX
            className={cn(
              'btn-icon text-error-base',
              copyBaseClassName,
              copyIconAnimation === 'enter' && 'scale-100 opacity-100',
              copyIconAnimation !== 'enter' && 'scale-0 opacity-0'
            )}
          />
        )}
      </>
    )
  }, [copyBaseClassName, copyIconAnimation, copyIconStatus])

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
            'group flex h-full cursor-pointer! flex-row items-center justify-center gap-0.5 border-none bg-transparent transition-colors duration-100 [-webkit-app-region:no-drag]',
            '[background-color:var(--selection-toolbar-button-bgcolor,transparent)]',
            '[border-radius:var(--selection-toolbar-button-border-radius,0)]',
            '[border:var(--selection-toolbar-button-border,0)]',
            '[box-shadow:var(--selection-toolbar-button-box-shadow,none)]',
            '[margin:var(--selection-toolbar-button-margin,0)]',
            '[padding:var(--selection-toolbar-button-padding,0_8px)]',
            'last:rounded-r-[var(--selection-toolbar-border-radius,10px)]',
            'last:[padding:var(--selection-toolbar-button-last-padding,0_12px_0_8px)]',
            'hover:[background-color:var(--selection-toolbar-button-bgcolor-hover,rgb(0_0_0_/_0.04))]',
            'dark:hover:[background-color:var(--selection-toolbar-button-bgcolor-hover,#333333)]'
          )}>
          <span
            className={cn(
              'relative flex items-center justify-center bg-transparent',
              '[height:var(--selection-toolbar-button-icon-size,16px)]',
              '[width:var(--selection-toolbar-button-icon-size,16px)]',
              '[&_svg]:[color:var(--selection-toolbar-button-icon-color,rgb(0_0_0))]',
              'dark:[&_svg]:[color:var(--selection-toolbar-button-icon-color,rgb(255_255_245_/_0.9))]',
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
                'btn-title max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap bg-transparent leading-[1.1] transition-colors duration-100',
                '[color:var(--selection-toolbar-button-text-color,rgb(0_0_0))]',
                'dark:[color:var(--selection-toolbar-button-text-color,rgb(255_255_245_/_0.9))]',
                '[font-size:var(--selection-toolbar-font-size,14px)]',
                '[margin:var(--selection-toolbar-button-text-margin,0)]',
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
        'box-border inline-flex select-none flex-row items-stretch overflow-hidden font-[var(--font-family-body)]',
        '[background:var(--selection-toolbar-background,var(--color-card))]',
        '[border-radius:var(--selection-toolbar-border-radius,10px)]',
        '[border:var(--selection-toolbar-border,0)]',
        '[box-shadow:var(--selection-toolbar-box-shadow,0_2px_3px_rgb(50_50_50_/_0.1))]',
        'dark:[box-shadow:var(--selection-toolbar-box-shadow,0_2px_3px_rgb(50_50_50_/_0.3))]',
        '[height:var(--selection-toolbar-height,36px)]',
        '[margin:var(--selection-toolbar-margin,2px_3px_5px_3px)!]',
        '[padding:var(--selection-toolbar-padding,0)!]'
      )}>
      <div
        className={cn(
          'items-center justify-center',
          '[background-color:var(--selection-toolbar-logo-background,transparent)]',
          '[border-color:var(--selection-toolbar-logo-border-color,rgb(0_0_0_/_0.08))]',
          'dark:[border-color:var(--selection-toolbar-logo-border-color,rgb(255_255_255_/_0.2))]',
          '[border-style:var(--selection-toolbar-logo-border-style,solid)]',
          '[border-width:var(--selection-toolbar-logo-border-width,0.5px_0_0.5px_0.5px)]',
          '[display:var(--selection-toolbar-logo-display,flex)]',
          '[margin:var(--selection-toolbar-logo-margin,0)]',
          '[padding:var(--selection-toolbar-logo-padding,0_6px_0_8px)]',
          'rounded-l-[var(--selection-toolbar-border-radius,10px)]',
          draggable && '[-webkit-app-region:drag]'
        )}>
        <img
          src={AppLogo}
          className="rounded-full object-cover [height:var(--selection-toolbar-logo-size,22px)] [width:var(--selection-toolbar-logo-size,22px)]"
          draggable={false}
          alt=""
        />
      </div>
      <div
        className={cn(
          'flex flex-row items-center justify-center bg-transparent [-webkit-app-region:no-drag]',
          '[border-color:var(--selection-toolbar-buttons-border-color,rgb(0_0_0_/_0.08))]',
          'dark:[border-color:var(--selection-toolbar-buttons-border-color,rgb(255_255_255_/_0.2))]',
          '[border-radius:var(--selection-toolbar-buttons-border-radius,0_var(--selection-toolbar-border-radius,10px)_var(--selection-toolbar-border-radius,10px)_0)]',
          '[border-style:var(--selection-toolbar-buttons-border-style,solid)]',
          '[border-width:var(--selection-toolbar-buttons-border-width,0.5px_0.5px_0.5px_0)]'
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
