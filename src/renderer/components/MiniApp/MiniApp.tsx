import { ConfirmDialog, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@logger'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import MiniAppIcon from '@renderer/components/icons/MiniAppIcon'
import IndicatorLight from '@renderer/components/IndicatorLight'
import MarqueeText from '@renderer/components/MarqueeText'
import { PendingPermissionsDialog } from '@renderer/components/MiniApp/PendingPermissionsDialog'
import { UpdateReviewDialog } from '@renderer/components/MiniApp/UpdateReviewDialog'
import { useMiniAppAttentionFor } from '@renderer/hooks/useMiniAppAttention'
import { useMiniAppUpdate } from '@renderer/hooks/useMiniAppUpdate'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { ErrorCode, isDataApiError, toDataApiError } from '@shared/data/api/errors'
import type { MiniApp, MiniAppStatus } from '@shared/data/types/miniApp'
import { isEqual } from 'es-toolkit/compat'
import type { FC, KeyboardEvent } from 'react'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import MiniAppDetailPanel from './MiniAppDetailPanel'

interface Props {
  app: MiniApp
  onClick?: () => void
  onOpen: (app: MiniApp, displayName: string) => void
  onEditCustom?: (app: MiniApp) => void
  onUpdateStatus: (appId: string, status: MiniAppStatus) => Promise<unknown>
  onHide: (appId: string) => Promise<unknown>
  onRemoveCustom: (appId: string) => Promise<unknown>
  onToggleSidebarFavorite: (appId: string) => void
  isPinned: boolean
  isSidebarFavorite: boolean
  isOpened: boolean
  isActive: boolean
  size?: number
  isLast?: boolean
  variant?: 'default' | 'launchpad'
  /** Renders the tile as unavailable: not activatable, not in the tab order. */
  disabled?: boolean
}

const logger = loggerService.withContext('App')

const MiniApp: FC<Props> = ({
  app,
  onClick,
  onOpen,
  onEditCustom,
  onUpdateStatus,
  onHide,
  onRemoveCustom,
  onToggleSidebarFavorite,
  isPinned,
  isSidebarFavorite,
  isOpened,
  isActive,
  size = 60,
  isLast,
  variant = 'default',
  disabled = false
}) => {
  const { t } = useTranslation()
  // The dot WITH its reasons: hover says why, the menu offers the action.
  const attention = useMiniAppAttentionFor(app.appId)
  const updating = attention?.updating ?? null
  // The dot means "something to do"; an update in flight is shown by the wedge instead.
  const needsAttention = attention !== undefined && updating === null
  /**
   * One list, two consumers: the tooltip a pointer user hovers, and the badge's accessible
   * name. The dot is the only place "a permission is waiting" is surfaced on this screen, so
   * leaving its meaning to hover leaves keyboard and screen-reader users without it.
   */
  const attentionReasons = attention
    ? [
        updating
          ? t('miniApp.attention.updating', {
              version: updating.version,
              percent: updating.fraction === null ? '…' : Math.round(updating.fraction * 100)
            })
          : attention.updateVersion
            ? t('miniApp.attention.update', { version: attention.updateVersion })
            : null,
        attention.pendingPermissions.length > 0
          ? t('miniApp.attention.pending', { count: attention.pendingPermissions.length })
          : null
      ].filter((line): line is string => line !== null)
    : []
  const update = useMiniAppUpdate(app.appId, { name: app.name })
  const [pendingOpen, setPendingOpen] = useState(false)
  const [pendingBusy, setPendingBusy] = useState(false)
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [removingCustom, setRemovingCustom] = useState(false)
  // Calculate display name
  const displayName = isLast ? t('settings.miniApps.custom.title') : app.nameKey ? t(app.nameKey) : app.name

  const handleClick = () => {
    if (disabled) return
    onOpen(app, displayName)
    onClick?.()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    handleClick()
  }
  const activationProps =
    variant === 'launchpad'
      ? ({
          onKeyDown: handleKeyDown,
          // Keyboard users must not be able to reach or activate a disabled
          // tile — `pointer-events-none` alone only stops the mouse.
          tabIndex: disabled ? -1 : 0,
          role: 'button',
          'aria-disabled': disabled || undefined,
          'aria-label': displayName
        } as const)
      : {}

  const reportFailure = (fallbackKey: string) => (err: unknown) => {
    const e = toDataApiError(err)
    if (isDataApiError(e)) {
      logger.error('mutation failed', { code: e.code, message: e.message })
      toast.error(e.message || t(fallbackKey))
    } else {
      logger.error('mutation failed', err as Error)
      toast.error(t(fallbackKey))
    }
  }

  const togglePinLabel = isPinned ? t('miniApp.remove_from_launchpad') : t('miniApp.add_to_launchpad')

  const handleTogglePin = () => {
    const nextStatus = isPinned ? 'enabled' : 'pinned'
    onUpdateStatus(app.appId, nextStatus).catch(reportFailure(isPinned ? 'miniApp.unpin_failed' : 'miniApp.pin_failed'))
  }

  const handleToggleSidebarFavorite = () => {
    onToggleSidebarFavorite(app.appId)
  }

  const handleHide = () => {
    onHide(app.appId).catch(reportFailure('miniApp.hide_failed'))
  }

  const handleRemoveCustom = async () => {
    setRemovingCustom(true)
    try {
      await onRemoveCustom(app.appId)
      toast.success(t('settings.miniApps.custom.remove_success'))
    } catch (error) {
      if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
        toast.warning(t('miniApp.error.not_found'))
      } else {
        toast.error(t('settings.miniApps.custom.remove_error'))
      }
      logger.error('Failed to remove custom mini app:', error as Error)
    } finally {
      setRemovingCustom(false)
    }
  }

  const isLaunchpad = variant === 'launchpad'

  const answerPending = async (route: 'mini_app.grant.approve_pending' | 'mini_app.grant.snooze_pending') => {
    setPendingBusy(true)
    try {
      await ipcApi.request(route, { appId: app.appId })
      setPendingOpen(false)
    } catch (error) {
      toast.error(t('miniApp.detail.action_error', { message: error instanceof Error ? error.message : String(error) }))
    } finally {
      setPendingBusy(false)
    }
  }

  const icon = isLaunchpad ? (
    <div className="mini-app-icon-clip flex size-full items-center justify-center overflow-hidden rounded-[inherit]">
      <MiniAppIcon size={size} app={app} appearance="plain" />
    </div>
  ) : (
    <MiniAppIcon size={size} app={app} appearance="avatar" />
  )

  const contextMenuItems: CommandContextMenuExtraItem[] = [
    { type: 'item', id: 'mini-app.toggle-pin', label: togglePinLabel, onSelect: handleTogglePin },
    {
      type: 'item',
      id: 'mini-app.toggle-sidebar-favorite',
      label: t(isSidebarFavorite ? 'miniApp.remove_from_sidebar' : 'miniApp.add_to_sidebar'),
      onSelect: handleToggleSidebarFavorite
    },
    ...(!isPinned
      ? ([
          { type: 'item', id: 'mini-app.hide', label: t('miniApp.sidebar.hide.title'), onSelect: handleHide }
        ] satisfies CommandContextMenuExtraItem[])
      : []),
    ...(updating
      ? ([
          {
            type: 'item',
            id: 'mini-app.updating',
            label: t('miniApp.menu.updating'),
            enabled: false,
            onSelect: () => undefined
          }
        ] satisfies CommandContextMenuExtraItem[])
      : attention?.updateVersion
        ? ([
            {
              type: 'item',
              id: 'mini-app.update',
              label: t('miniApp.menu.update', { version: attention.updateVersion }),
              // A fresh check, never the dot's token: the dot may be hours old and its token expired.
              onSelect: () => void update.check()
            }
          ] satisfies CommandContextMenuExtraItem[])
        : []),
    ...(attention && attention.pendingPermissions.length > 0
      ? ([
          {
            type: 'item',
            id: 'mini-app.grant-pending',
            label: t('miniApp.menu.grant_pending'),
            onSelect: () => setPendingOpen(true)
          }
        ] satisfies CommandContextMenuExtraItem[])
      : []),
    ...(app.kind === 'app'
      ? ([
          { type: 'item', id: 'mini-app.detail', label: t('miniApp.detail.open'), onSelect: () => setDetailOpen(true) }
        ] satisfies CommandContextMenuExtraItem[])
      : []),
    // Installed apps also have a null `presetMiniAppId`, but the service refuses to edit
    // or delete them — offering the items would only produce an error toast.
    ...(app.kind === 'site' && app.presetMiniAppId == null
      ? ([
          ...(onEditCustom
            ? ([
                {
                  type: 'item',
                  id: 'mini-app.edit-custom',
                  label: t('common.edit'),
                  onSelect: () => onEditCustom(app)
                }
              ] satisfies CommandContextMenuExtraItem[])
            : []),
          {
            type: 'item',
            id: 'mini-app.remove-custom',
            label: t('common.delete'),
            destructive: true,
            onSelect: () => setRemoveConfirmOpen(true)
          }
        ] satisfies CommandContextMenuExtraItem[])
      : [])
  ]

  return (
    <>
      <CommandContextMenu location="webcontents.context" extraItems={contextMenuItems}>
        <div
          className={cn(
            'flex flex-col items-center justify-center overflow-hidden outline-none',
            disabled ? 'cursor-default' : 'cursor-pointer',
            isLaunchpad
              ? 'min-h-[104px] w-[92px] bg-transparent pt-1 hover:[&_.mini-app-icon-frame]:bg-accent focus-visible:[&_.mini-app-icon-frame]:border-ring focus-visible:[&_.mini-app-icon-frame]:bg-accent'
              : 'min-h-[85px]'
          )}
          onClick={handleClick}
          {...activationProps}>
          <Tooltip
            isDisabled={!attention}
            content={
              attentionReasons.length > 0 && (
                <div className="flex flex-col gap-0.5">
                  {attentionReasons.map((reason) => (
                    <span key={reason}>{reason}</span>
                  ))}
                </div>
              )
            }>
            <div
              className={cn(
                'mini-app-icon-frame relative flex items-center justify-center',
                isLaunchpad &&
                  'size-[58px] rounded-[14px] border border-border-subtle bg-transparent transition-[border-color,background-color] duration-[160ms] ease-in-out motion-reduce:transition-none'
              )}>
              {icon}
              {updating && (
                // iOS style: ONE icon, faded by an overlay that covers only what has not landed yet —
                // the mask cuts the downloaded wedge out of the fade, so full colour returns clockwise.
                <div
                  data-testid="update-progress"
                  className={cn(
                    'absolute inset-0 flex items-center justify-center bg-background/65',
                    isLaunchpad ? 'rounded-[inherit]' : 'rounded-lg'
                  )}
                  style={
                    updating.fraction === null
                      ? undefined
                      : {
                          maskImage: `conic-gradient(transparent ${updating.fraction * 100}%, #000 0)`,
                          WebkitMaskImage: `conic-gradient(transparent ${updating.fraction * 100}%, #000 0)`
                        }
                  }>
                  {updating.fraction === null && (
                    <div className="size-5 animate-spin rounded-full border-2 border-foreground/60 border-t-transparent" />
                  )}
                </div>
              )}
              {needsAttention && (
                <span
                  // `role="img"` + a name, because the dot carries state no other element on
                  // the tile does: the tile's own accessible name is the app's name, and in
                  // the non-launchpad variant it has no role at all.
                  role="img"
                  aria-label={attentionReasons.join('. ')}
                  data-testid="attention-badge"
                  className={cn(
                    'absolute size-2 rounded-full bg-warning ring-2 ring-background',
                    isLaunchpad ? '-top-[3px] -right-[3px]' : '-top-0.5 -right-0.5'
                  )}
                />
              )}
              {isOpened && (
                <div
                  className={cn(
                    'absolute rounded-full bg-background',
                    isLaunchpad
                      ? '-right-[3px] -bottom-[3px] p-[3px] shadow-[0_0_0_1px_var(--border-subtle)]'
                      : '-right-0.5 -bottom-0.5 p-0.5'
                  )}>
                  <IndicatorLight color="var(--success)" size={6} animation={!isActive} />
                </div>
              )}
            </div>
          </Tooltip>
          <div
            className={cn(
              'w-full select-none text-center text-muted-foreground',
              isLaunchpad
                ? 'mt-2 min-h-9 max-w-[92px] overflow-hidden whitespace-normal text-[13px] leading-[18px] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box] [overflow-wrap:anywhere]'
                : 'mt-[5px] max-w-20 text-xs leading-normal'
            )}>
            {isLaunchpad ? displayName : <MarqueeText>{displayName}</MarqueeText>}
          </div>
        </div>
      </CommandContextMenu>
      <ConfirmDialog
        open={removeConfirmOpen}
        onOpenChange={setRemoveConfirmOpen}
        title={t('settings.miniApps.custom.remove_confirm_title')}
        description={t('settings.miniApps.custom.remove_confirm_description', { name: displayName })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        destructive
        confirmLoading={removingCustom}
        onConfirm={handleRemoveCustom}
      />
      {/* Mounted only while open: the panel fetches on mount and owns its own dialogs. */}
      {detailOpen && <MiniAppDetailPanel appId={app.appId} onClose={() => setDetailOpen(false)} />}
      {update.offer && (
        <UpdateReviewDialog
          name={app.name}
          update={update.offer}
          busy={update.busy}
          onCancel={update.dismiss}
          onApply={update.apply}
        />
      )}
      {pendingOpen && attention && attention.pendingPermissions.length > 0 && (
        <PendingPermissionsDialog
          name={app.name}
          leaves={attention.pendingPermissions}
          busy={pendingBusy}
          onCancel={() => setPendingOpen(false)}
          onGrant={() => void answerPending('mini_app.grant.approve_pending')}
          onSnooze={() => void answerPending('mini_app.grant.snooze_pending')}
        />
      )}
    </>
  )
}

// DataApi refreshes reserialize rows; preserve cards whose small per-app snapshot is unchanged.
export default memo(MiniApp, isEqual)
