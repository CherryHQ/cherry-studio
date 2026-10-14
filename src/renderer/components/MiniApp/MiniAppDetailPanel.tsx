import type { TFunction } from 'i18next'
import { Info } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip
} from '@cherrystudio/ui'
import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { DefaultModelSelector } from '@renderer/components/DefaultModelSelector'
import MiniAppLogoAvatar from '@renderer/components/icons/MiniAppLogoAvatar'
import { InstallConsentDialog } from '@renderer/components/MiniApp/InstallConsentDialog'
import { PermissionChecklist } from '@renderer/components/MiniApp/PermissionChecklist'
import { UpdateReviewDialog } from '@renderer/components/MiniApp/UpdateReviewDialog'
import { useMiniAppAttentionFor } from '@renderer/hooks/useMiniAppAttention'
import { useMiniAppInstallPreview } from '@renderer/hooks/useMiniAppInstallPreview'
import { useMiniAppUpdate } from '@renderer/hooks/useMiniAppUpdate'
import { useModelById } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { formatFileSize } from '@renderer/utils/file'
import { permissionLabel } from '@renderer/utils/miniAppPermission'
import { isUniqueModelId, type Model, type UniqueModelId } from '@shared/data/types/model'
import type { MiniAppDetail } from '@shared/ipc/schemas/miniApp'
import type { MiniAppActivityEntry, MiniAppActivityGrant, MiniAppActivityListing } from '@shared/types/miniAppActivity'
import type { QuotaUsageWithLimits } from '@shared/types/miniAppQuota'
import { isNonChatModel } from '@shared/utils/model'

type DestructiveAction = 'clear_data' | 'uninstall'

/** Literal keys, so the catalog check sees them; the grant names are a closed set. */
const GRANT_ACTIVITY_KEYS: Record<MiniAppActivityGrant['name'], string> = {
  install: 'miniApp.activity.grant.install',
  reinstall: 'miniApp.activity.grant.reinstall',
  update: 'miniApp.activity.grant.update',
  rollback: 'miniApp.activity.grant.rollback',
  grant: 'miniApp.activity.grant.grant',
  revoke: 'miniApp.activity.grant.revoke',
  grant_pending: 'miniApp.activity.grant.grant_pending',
  snooze_pending: 'miniApp.activity.grant.snooze_pending',
  clear_data: 'miniApp.activity.grant.clear_data'
}

const VERSIONED_GRANTS = new Set<MiniAppActivityGrant['name']>(['install', 'reinstall', 'update'])

/** One line per entry. Calls show their metadata facet as-is: it never holds a payload. */
function describeActivity(t: TFunction, entry: MiniAppActivityEntry): string {
  switch (entry.kind) {
    case 'call': {
      const facet = Object.entries(entry.facet ?? {})
        .map(([key, value]) => `${key}=${value}`)
        .join(' ')
      return `${entry.name} → ${entry.outcome}${facet ? ` · ${facet}` : ''}`
    }
    case 'grant': {
      const parts = [
        t(GRANT_ACTIVITY_KEYS[entry.name], {
          version: entry.version ?? '',
          permissions: (entry.permissions ?? []).join(', ')
        })
      ]
      // Versioned entries name what changed only when something did: no dangling "granted ".
      if (VERSIONED_GRANTS.has(entry.name)) {
        if (entry.permissions?.length)
          parts.push(t('miniApp.activity.grant.granted', { permissions: entry.permissions.join(', ') }))
        if (entry.removed?.length)
          parts.push(t('miniApp.activity.grant.revoked', { permissions: entry.removed.join(', ') }))
      }
      return parts.join(', ')
    }
    case 'count':
      return t('miniApp.activity.count', {
        name: entry.name,
        calls: entry.calls,
        bytes: formatFileSize(entry.bytes)
      })
    case 'truncated':
      return t('miniApp.activity.truncated')
  }
}

interface Props {
  appId: string
  /** Called once the panel is done — after an uninstall, or when the user closes it. */
  onClose?: () => void
}

const logger = loggerService.withContext('MiniAppDetailPanel')

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const asUniqueModelId = (id: string | null | undefined): UniqueModelId | null => (id && isUniqueModelId(id) ? id : null)

const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const Usage: FC<{ label: string; usage: QuotaUsageWithLimits; testId: string }> = ({ label, usage, testId }) => {
  const { t } = useTranslation()
  // Two axes, and the quota is exhausted when EITHER fills: the bar shows the fuller one.
  const fraction = (used: number, limit: number) => (limit > 0 ? Math.min(1, used / limit) : 0)
  const ratio = Math.max(fraction(usage.bytes, usage.bytesLimit), fraction(usage.count, usage.countLimit))
  return (
    <div data-testid={testId} className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {t('miniApp.detail.usage', {
            count: usage.count,
            limit: usage.countLimit,
            bytes: formatFileSize(usage.bytes),
            bytesLimit: formatFileSize(usage.bytesLimit)
          })}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  )
}

/**
 * The detail panel — design §11's table, one control per column, each with exactly one
 * writer route. The renderer holds no update state beyond the token the check returned:
 * that token IS the consent record, and applying re-sends it and nothing else.
 */
const MiniAppDetailPanel: FC<Props> = ({ appId, onClose }) => {
  const { t, i18n } = useTranslation()
  const [detail, setDetail] = useState<MiniAppDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingAction, setPendingAction] = useState<DestructiveAction | null>(null)
  const { providers } = useProviders()
  const { model: defaultModel } = useModelById(asUniqueModelId(detail?.aiModelId))
  const { model: quickModel } = useModelById(asUniqueModelId(detail?.aiQuickModelId))
  const chatModelFilter = useCallback((model: Model) => !isNonChatModel(model), [])
  // A plain column write: DataApi, not a command. The panel's own state still comes from `mini_app.detail`.
  const { trigger: patchMiniApp } = useMutation('PATCH', '/mini-apps/:appId')
  const patchModels = (body: { aiModelId?: UniqueModelId | null; aiQuickModelId?: UniqueModelId | null }) =>
    patchMiniApp({ params: { appId }, body })

  const [activity, setActivity] = useState<MiniAppActivityListing>({ entries: [], bytes: 0, days: 0 })
  const [deniedOnly, setDeniedOnly] = useState(false)
  const loadActivity = useCallback(async () => {
    try {
      setActivity(await ipcApi.request('mini_app.activity.list', { appId, limit: 100, deniedOnly }))
    } catch (e) {
      logger.error('Failed to load mini app activity', e as Error)
      // Not a silent empty list: this panel is where a user goes to find out what an app
      // did, and "nothing recorded" is the one answer a failed read must never give.
      setError(t('miniApp.activity.load_error', { message: errorMessage(e) }))
    }
  }, [appId, deniedOnly, t])
  // Pulled on open, on the filter, and on the user's refresh — never pushed: a log that
  // grows all day would broadcast to every window for a panel that is rarely open.
  useEffect(() => {
    void loadActivity()
  }, [loadActivity])
  // Built once per language, not once per row: constructing a formatter with an options
  // object misses V8's default-format cache, and the activity list renders up to 100 of them
  // on every `busy` flip, filter toggle and attention broadcast.
  const timeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }),
    [i18n.language]
  )
  const timeOf = (ts: number) => timeFormat.format(ts)

  const reload = useCallback(async () => {
    try {
      setDetail(await ipcApi.request('mini_app.detail', { appId }))
    } catch (e) {
      logger.error('Failed to load mini app detail', e as Error)
      setError(t('miniApp.detail.load_error', { message: errorMessage(e) }))
    }
  }, [appId, t])

  useEffect(() => {
    void reload()
  }, [reload])

  /** Every write goes through here: one spinner, one error surface, one reload after. */
  const run = async (action: () => Promise<unknown>, { reloadAfter = true } = {}) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      if (reloadAfter) await reload()
      return true
    } catch (e) {
      logger.error('Mini app action failed', e as Error)
      setError(t('miniApp.detail.action_error', { message: errorMessage(e) }))
      return false
    } finally {
      setBusy(false)
    }
  }

  // Live, from the same broadcast the tile draws its wedge from — not the one-shot detail read.
  const updating = useMiniAppAttentionFor(appId)?.updating ?? null
  // Check → review dialog → apply: the same three steps the tile's menu runs.
  const update = useMiniAppUpdate(appId, {
    name: detail?.name ?? appId,
    onApplied: () => void reload(),
    onChecked: () => void reload()
  })
  /**
   * Nothing that changes the package may run while an update is landing — `update.busy`
   * included: a check is the one package operation on this screen that does NOT go through
   * `run()`, so it never raises `busy` of its own and would leave its own button live.
   */
  const locked = busy || updating !== null || update.busy

  // "Replace package" is the install entry pinned to THIS app: main decides by version
  // whether the file is an upgrade or a reinstall, and the same card asks the questions.
  const replace = useMiniAppInstallPreview(reload, { expectAppId: appId })
  const replaceError = replace.error
  useEffect(() => {
    if (replaceError) toast.error(t(replaceError.key, replaceError.params))
  }, [replaceError, t])
  const handlePickReplacement = () =>
    replace.settle(() => ipcApi.request('mini_app.install.pick_and_preview'), 'miniApp.install.preview_error')

  const handleConfirmDestructive = async () => {
    if (!pendingAction) return
    const action = pendingAction
    // Nothing to reload after an uninstall: the row is gone, and the panel closes with it.
    const ok = await run(() => ipcApi.request(`mini_app.${action}`, { appId }), {
      reloadAfter: action !== 'uninstall'
    })
    if (ok && action === 'uninstall') {
      toast.success(t('miniApp.detail.uninstall_success', { name: detail?.name ?? appId }))
      onClose?.()
    }
  }

  const confirmCopy: Record<DestructiveAction, { title: string; description: string }> = {
    clear_data: {
      title: t('miniApp.detail.clear_data'),
      description: t('miniApp.detail.clear_data_confirm', { name: detail?.name ?? appId })
    },
    uninstall: {
      title: t('miniApp.detail.uninstall'),
      description: t('miniApp.detail.uninstall_confirm', { name: detail?.name ?? appId })
    }
  }

  const sourceLine = (d: MiniAppDetail): string => {
    if (d.source === 'url') return t('miniApp.detail.source.url', { host: hostOf(d.sourceUrl ?? '') })
    if (d.source === 'builtin') return t('miniApp.detail.source.builtin')
    return t('miniApp.detail.source.file')
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose?.()
        }}>
        {/* Header / body / footer as grid rows: only the body scrolls (`minmax(0,1fr)` lets it shrink), and
            no `overflow` on the card itself — tooltips portal into it and a clipping box would cut them. */}
        <DialogContent
          aria-describedby={undefined}
          className="max-h-[85vh] min-h-[60vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl">
          {/* `min-w-0` on BOTH grid items: a truncated title is unbreakable, and a grid item's min-content width would widen the whole card. */}
          <DialogHeader className="min-w-0">
            <div className="flex min-w-0 items-center gap-3">
              {detail && <MiniAppLogoAvatar logo={detail.logo ?? detail.logoSrc} size={40} className="shrink-0" />}
              <div className="min-w-0">
                {/* Both lines truncate; hover shows the whole thing — a 64-char name and a 120-char id are legal. */}
                <Tooltip content={detail?.name ?? ''} fullWidthTrigger isDisabled={!detail}>
                  <DialogTitle className="truncate">{detail?.name ?? t('common.loading')}</DialogTitle>
                </Tooltip>
                <Tooltip content={appId} fullWidthTrigger>
                  <div className="truncate font-normal text-muted-foreground text-xs">{appId}</div>
                </Tooltip>
              </div>
            </div>
            {/* In the pinned header, not the scrolling body: a refused action must stay in view. */}
            {error && <Alert type="error" message={error} />}
          </DialogHeader>

          {detail && (
            <div className="flex min-h-0 min-w-0 flex-col gap-5 overflow-y-auto py-2 text-sm">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  <span>{t('miniApp.install.version', { version: detail.version })}</span>
                  <span>·</span>
                  <span>{sourceLine(detail)}</span>
                  {updating ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning-subtle px-2 py-0.5 text-warning-subtle-foreground">
                      <span className="size-1.5 animate-pulse rounded-full bg-warning" />
                      {t('miniApp.attention.updating', {
                        version: updating.version,
                        percent: updating.fraction === null ? '…' : Math.round(updating.fraction * 100)
                      })}
                    </span>
                  ) : (
                    detail.updateVersion && (
                      // Says what the dot means and goes straight to the review — a fresh check, for a fresh token.
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => void update.check()}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-warning-subtle px-2 py-0.5 text-warning-subtle-foreground hover:underline focus-visible:underline disabled:cursor-default">
                        <span className="size-1.5 rounded-full bg-warning" />
                        {t('miniApp.attention.update', { version: detail.updateVersion })}
                      </button>
                    )
                  )}
                </div>
                {/* The description precedes the permissions: it is the reason the user judges them by. */}
                <p>{detail.description}</p>
              </div>

              {detail.pendingAdditions.length > 0 && (
                <Alert
                  type="warning"
                  message={t('miniApp.detail.pending_title')}
                  description={
                    <div className="flex flex-col gap-2">
                      <p className="text-xs">{t('miniApp.detail.pending_hint')}</p>
                      <ul className="flex flex-col gap-0.5 text-xs">
                        {detail.pendingAdditions.map((key) => (
                          <li key={key}>{permissionLabel(t, key)}</li>
                        ))}
                      </ul>
                    </div>
                  }
                  action={
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => run(() => ipcApi.request('mini_app.grant.snooze_pending', { appId }))}>
                        {t('miniApp.detail.pending_snooze')}
                      </Button>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => run(() => ipcApi.request('mini_app.grant.approve_pending', { appId }))}>
                        {t('miniApp.detail.grant_pending')}
                      </Button>
                    </div>
                  }
                />
              )}

              {/* Grows into whatever the dialog's own `min-h`/`max-h` leaves, so the activity list
                  below ends where the dialog does instead of at a fixed 14rem. The floor is not
                  `min-h-0`: this sits in a scrolling flex column, and a zero floor lets an update
                  card above squash the panel instead of making that column scroll. */}
              <Tabs defaultValue="permissions" className="min-h-56 flex-1 gap-3">
                <TabsList className="w-full">
                  <TabsTrigger value="permissions" className="flex-1">
                    {t('miniApp.detail.permissions_title')}
                  </TabsTrigger>
                  <TabsTrigger value="space" className="flex-1">
                    {t('miniApp.detail.storage_title')}
                  </TabsTrigger>
                  <TabsTrigger value="activity" className="flex-1">
                    {t('miniApp.activity.title')}
                  </TabsTrigger>
                  <TabsTrigger value="settings" className="flex-1">
                    {t('miniApp.detail.settings_title')}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="permissions" className="flex flex-col gap-2 px-3">
                  <PermissionChecklist
                    items={detail.declared.map((leaf) => ({
                      key: leaf.key,
                      checked: leaf.granted,
                      fixed: !leaf.optional
                    }))}
                    hosts={detail.network}
                    disabled={busy}
                    onToggle={(key, on) =>
                      run(() =>
                        ipcApi.request(on ? 'mini_app.grant.approve' : 'mini_app.grant.revoke', {
                          appId,
                          permission: key
                        })
                      )
                    }
                  />
                </TabsContent>
                <TabsContent value="space" className="flex flex-col gap-3 px-3">
                  <div data-testid="package-size" className="flex items-center justify-between text-xs">
                    <span>{t('miniApp.detail.package_size')}</span>
                    <span className="text-muted-foreground">{formatFileSize(detail.packageBytes)}</span>
                  </div>
                  {detail.snapshotBytes > 0 && (
                    <div data-testid="snapshot-size" className="flex items-center justify-between text-xs">
                      <span>{t('miniApp.detail.snapshot_size')}</span>
                      <span className="text-muted-foreground">{formatFileSize(detail.snapshotBytes)}</span>
                    </div>
                  )}
                  <Usage label={t('miniApp.detail.storage_usage')} usage={detail.storage} testId="storage-usage" />
                  <Usage label={t('miniApp.detail.file_usage')} usage={detail.file} testId="file-usage" />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => setPendingAction('clear_data')}>
                      {t('miniApp.detail.clear_data')}
                    </Button>
                  </div>
                </TabsContent>
                <TabsContent value="activity" className="flex min-h-0 flex-col gap-3 px-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                      {activity.days > 0 && (
                        <span data-testid="activity-size">
                          {t('miniApp.activity.size', { bytes: formatFileSize(activity.bytes), files: activity.days })}
                        </span>
                      )}
                      <Tooltip content={t('miniApp.activity.hint')}>
                        <Info size={14} aria-label={t('miniApp.activity.hint')} />
                      </Tooltip>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void loadActivity()}>
                        {t('miniApp.activity.refresh')}
                      </Button>
                      <Button
                        size="sm"
                        variant={deniedOnly ? 'default' : 'outline'}
                        aria-pressed={deniedOnly}
                        onClick={() => setDeniedOnly((value) => !value)}>
                        {t('miniApp.activity.denied_only')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          run(() => ipcApi.request('mini_app.activity.open_folder', { appId }), { reloadAfter: false })
                        }>
                        {t('miniApp.activity.open_folder')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || activity.entries.length === 0}
                        onClick={() =>
                          run(
                            async () => {
                              await ipcApi.request('mini_app.activity.clear', { appId })
                              await loadActivity()
                            },
                            { reloadAfter: false }
                          )
                        }>
                        {t('miniApp.activity.clear')}
                      </Button>
                    </div>
                  </div>
                  {activity.entries.length === 0 ? (
                    <p className="text-muted-foreground text-xs">{t('miniApp.activity.empty')}</p>
                  ) : (
                    <ul
                      className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto font-mono text-xs"
                      data-testid="activity-list">
                      {activity.entries.map((entry, index) => (
                        <li
                          key={`${entry.ts}-${index}`}
                          className={
                            entry.kind === 'call' && entry.outcome !== 'ok'
                              ? 'flex gap-2 text-destructive'
                              : 'flex gap-2'
                          }>
                          <span className="shrink-0 text-muted-foreground">{timeOf(entry.ts)}</span>
                          {/* `min-w-0` as well as `break-words`: a flex item will not shrink past its
                              longest word, and `overflow-wrap` alone does not lower that floor. */}
                          <span className="min-w-0 break-words">{describeActivity(t, entry)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>
                <TabsContent value="settings" className="flex flex-col gap-5 px-3">
                  <section className="flex flex-col gap-2">
                    <h3 className="font-medium">{t('miniApp.detail.model_title')}</h3>
                    {/* The same two slots Cherry keeps globally; an empty slot follows the global one. */}
                    {[
                      {
                        key: 'default',
                        label: t('miniApp.detail.model_default_label'),
                        placeholder: t('miniApp.detail.model_default'),
                        model: defaultModel,
                        set: detail.aiModelId !== null,
                        write: (id: UniqueModelId | null) => patchModels({ aiModelId: id })
                      },
                      {
                        key: 'quick',
                        label: t('miniApp.detail.model_quick_label'),
                        placeholder: t('miniApp.detail.model_quick_default'),
                        model: quickModel,
                        set: detail.aiQuickModelId !== null,
                        write: (id: UniqueModelId | null) => patchModels({ aiQuickModelId: id })
                      }
                    ].map((slot) => (
                      <div key={slot.key} data-testid={`model-slot-${slot.key}`} className="flex items-center gap-2">
                        <span className="w-20 shrink-0 text-muted-foreground text-sm">{slot.label}</span>
                        <DefaultModelSelector
                          model={slot.model}
                          providers={providers}
                          filter={chatModelFilter}
                          placeholder={slot.placeholder}
                          onSelect={(model) => run(() => slot.write(model?.id ?? null))}
                        />
                        {slot.set && (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => slot.write(null))}>
                            {t('miniApp.detail.model_use_default')}
                          </Button>
                        )}
                      </div>
                    ))}
                  </section>

                  <section className="flex flex-col gap-2">
                    <h3 className="font-medium">{t('miniApp.detail.updates_title')}</h3>
                    <div className="flex flex-wrap items-center gap-2">
                      {/* A local package has no endpoint to check; every app can be handed a new package. */}
                      {detail.source !== 'file' && (
                        <Button size="sm" variant="outline" disabled={locked} onClick={() => void update.check()}>
                          {t('miniApp.detail.check_update')}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={locked || replace.busy}
                        onClick={handlePickReplacement}>
                        {t('miniApp.detail.replace_package')}
                      </Button>
                      {detail.canRollback && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={locked}
                          onClick={() => run(() => ipcApi.request('mini_app.update.rollback', { appId }))}>
                          {t('miniApp.detail.rollback')}
                        </Button>
                      )}
                    </div>
                    {update.current && (
                      <p className="text-muted-foreground text-xs">{t('miniApp.detail.up_to_date')}</p>
                    )}
                  </section>
                </TabsContent>
              </Tabs>
            </div>
          )}

          {/* Pinned: the one irreversible action is never something to scroll for. */}
          {detail && (
            <DialogFooter>
              <div className="flex gap-2 sm:mr-auto">
                <Button variant="destructive" disabled={locked} onClick={() => setPendingAction('uninstall')}>
                  {t('miniApp.detail.uninstall')}
                </Button>
                {/* The same review dialog the chip and the tile's menu open — one more door to it, pinned. */}
                {updating ? (
                  <Button disabled loading>
                    {t('miniApp.menu.updating')}
                  </Button>
                ) : (
                  detail.updateVersion && (
                    <Button disabled={locked} onClick={() => void update.check()}>
                      {t('miniApp.menu.update', { version: detail.updateVersion })}
                    </Button>
                  )
                )}
              </div>
              {/* "Close", not "Cancel": every change on this panel is already written the moment it is made. */}
              <Button variant="outline" onClick={() => onClose?.()}>
                {t('common.close')}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {update.offer && detail && (
        <UpdateReviewDialog
          name={detail.name}
          update={update.offer}
          busy={update.busy}
          onCancel={update.dismiss}
          onApply={update.apply}
        />
      )}
      {replace.preview && (
        <InstallConsentDialog
          preview={replace.preview}
          busy={replace.busy}
          onCancel={replace.cancelPreview}
          onConfirm={replace.confirm}
        />
      )}
      <ConfirmDialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null)
        }}
        title={pendingAction ? confirmCopy[pendingAction].title : ''}
        description={pendingAction ? confirmCopy[pendingAction].description : ''}
        confirmText={t('common.confirm')}
        cancelText={t('common.cancel')}
        destructive
        confirmLoading={busy}
        onConfirm={handleConfirmDestructive}
      />
    </>
  )
}

export default MiniAppDetailPanel
