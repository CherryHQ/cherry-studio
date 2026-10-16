import { Plus, RefreshCw, X } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { skillErrorCodes } from '@shared/ipc/errors/skill'
import { normalizeSubscriptionUrl } from '@shared/utils/skillSubscription'

export function SkillSubscriptionBar({
  sourceId,
  onSelect,
  onRefresh,
  refreshing,
  active
}: {
  sourceId: string | null
  onSelect: (id: string | null) => void
  onRefresh: () => void
  refreshing: boolean
  active: boolean
}) {
  const { t } = useTranslation()
  const [sources] = usePreference('ui.marketplace.skill_sources')
  const [adding, setAdding] = useState(false)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const addRef = useRef<HTMLButtonElement>(null)
  useLayoutEffect(
    () => () => {
      setAdding(false)
      setRemoveId(null)
    },
    []
  )
  return (
    <div className="flex shrink-0 items-center gap-2 py-3">
      <div
        className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto"
        aria-label={t('marketplace.subscription.sources')}>
        <Button
          size="sm"
          variant={sourceId === null ? 'default' : 'ghost'}
          className="shrink-0 rounded-full focus-visible:underline"
          style={sourceId === null ? { backgroundColor: '#ffa39e', color: '#ffffff' } : undefined}
          aria-pressed={sourceId === null}
          onClick={() => onSelect(null)}>
          {t('marketplace.curated')}
        </Button>
        <Button
          ref={addRef}
          size="icon-sm"
          variant="ghost"
          className="shrink-0 rounded-full"
          title={t('marketplace.subscription.add')}
          aria-label={t('marketplace.subscription.add')}
          onClick={() => setAdding(true)}>
          <Plus className="size-4" />
        </Button>
        {sources.map((source) => (
          <Button
            key={source.id}
            size="sm"
            variant={sourceId === source.id ? 'default' : 'ghost'}
            className="max-w-48 shrink-0 rounded-full"
            title={source.name}
            aria-pressed={sourceId === source.id}
            onClick={() => onSelect(source.id)}>
            <span className="truncate">{source.name}</span>
          </Button>
        ))}
      </div>
      {sourceId ? (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 rounded-full"
            onClick={onRefresh}
            disabled={refreshing}
            title={t('marketplace.subscription.refresh')}
            aria-label={t('marketplace.subscription.refresh')}>
            <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 rounded-full"
            onClick={() => setRemoveId(sourceId)}
            title={t('marketplace.subscription.remove')}
            aria-label={t('marketplace.subscription.remove')}>
            <X className="size-3.5" />
          </Button>
        </>
      ) : null}
      {active && adding ? (
        <AddSubscriptionDialog
          onClose={() => setAdding(false)}
          onAdded={onSelect}
          onReturnFocus={() => addRef.current?.focus()}
        />
      ) : null}
      {active ? (
        <ConfirmDialog
          open={Boolean(removeId)}
          onOpenChange={(open) => {
            if (!open && !removing) setRemoveId(null)
          }}
          title={t('marketplace.subscription.remove')}
          description={t('marketplace.subscription.remove_description')}
          confirmText={t('marketplace.subscription.remove')}
          cancelText={t('common.cancel')}
          confirmLoading={removing}
          cancelDisabled={removing}
          onConfirm={async () => {
            if (!removeId) return false
            setRemoving(true)
            try {
              await ipcApi.request('skill.subscription.remove', { sourceId: removeId })
              if (sourceId === removeId) onSelect(null)
              setRemoveId(null)
              return true
            } catch {
              toast.error(t('common.delete_failed'))
              return false
            } finally {
              setRemoving(false)
            }
          }}
        />
      ) : null}
    </div>
  )
}

function AddSubscriptionDialog({
  onClose,
  onAdded,
  onReturnFocus
}: {
  onClose: () => void
  onAdded: (id: string) => void
  onReturnFocus: () => void
}) {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending.current) onClose()
      }}>
      <DialogContent
        className="gap-0 rounded-3xl p-6 pb-10 sm:max-w-lg"
        overlayClassName="backdrop-blur-sm"
        showCloseButton={!busy}
        closeLabel={t('common.close')}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          onReturnFocus()
        }}>
        <DialogHeader className="text-left">
          <DialogTitle className="text-xl font-medium">{t('marketplace.subscription.add')}</DialogTitle>
          <DialogDescription className="text-xs leading-5">
            {t('marketplace.subscription.description')}
          </DialogDescription>
        </DialogHeader>
        <form
          className="mt-6"
          onSubmit={async (event) => {
            event.preventDefault()
            if (pending.current || !normalizeSubscriptionUrl(url)) return
            pending.current = true
            setBusy(true)
            setError('')
            try {
              const source = await ipcApi.request('skill.subscription.add', { url })
              onAdded(source.id)
              onClose()
            } catch (cause) {
              const key =
                cause instanceof IpcError && cause.code === skillErrorCodes.SUBSCRIPTION_EMPTY
                  ? 'marketplace.subscription.empty_source'
                  : cause instanceof IpcError && cause.code === skillErrorCodes.SUBSCRIPTION_INVALID
                    ? 'marketplace.subscription.invalid_url'
                    : 'marketplace.subscription.load_failed'
              setError(t(key))
            } finally {
              pending.current = false
              setBusy(false)
            }
          }}>
          <Label htmlFor="skill-subscription-url" className="mb-1.5 block text-xs text-muted-foreground">
            {t('marketplace.subscription.url')}
          </Label>
          <Input
            id="skill-subscription-url"
            type="url"
            autoFocus
            value={url}
            disabled={busy}
            className="h-9 min-w-17 rounded-xl"
            placeholder="https://example.com/feed.json"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'skill-subscription-error' : undefined}
            onChange={(event) => {
              setUrl(event.target.value)
              setError('')
            }}
          />
          {error ? (
            <p id="skill-subscription-error" role="alert" className="mt-2 text-xs text-error">
              {error}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2 border-t border-border-subtle pt-5">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
              className="h-9 min-w-17 rounded-xl">
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={!normalizeSubscriptionUrl(url) || busy}
              loading={busy}
              className="h-9 min-w-17 rounded-xl">
              {t('common.add')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
