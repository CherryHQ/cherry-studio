import { AlertCircle, Check, CheckCircle2, Copy, Edit3, Loader2, Plus, Trash2, X, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'

import { Button, Input, Switch, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import Scrollbar from '@renderer/components/Scrollbar'
import { useProviderApiKeys, useProviderMutations } from '@renderer/hooks/useProvider'
import { toast } from '@renderer/services/toast'
import { maskApiKey } from '@renderer/utils/api'
import type { ApiKeyEntry } from '@shared/data/types/provider'

import ProviderSettingsDrawer from '../primitives/ProviderSettingsDrawer'
import { apiKeyListClasses } from '../primitives/ProviderSettingsPrimitives'
import { ApiKeyNote } from './ApiKeyNote'
import { ApiKeyQuotaLimit } from './ApiKeyQuotaLimit'
import { ApiKeyRotationPolicy } from './ApiKeyRotationPolicy'
import { copyApiKeyToClipboard } from './copyApiKeyToClipboard'
import { type ApiKeyProbeState, useApiKeyProbe } from './useApiKeyProbe'

interface ProviderApiKeyListDrawerProps {
  providerId: string
  open: boolean
  onClose: () => void
}

interface DraftState {
  id: string
  key: string
  label: string
  isNew: boolean
}

const createEmptyDraft = (): DraftState => ({
  id: uuidv4(),
  key: '',
  label: '',
  isNew: true
})

const logger = loggerService.withContext('ProviderApiKeyListDrawer')

function normalizeApiKeyValue(value: string) {
  return value.trim()
}

function toDraft(entry: ApiKeyEntry): DraftState {
  return {
    id: entry.id,
    key: entry.key,
    label: entry.label ?? '',
    isNew: false
  }
}

export default function ProviderApiKeyListDrawer({ providerId, open, onClose }: ProviderApiKeyListDrawerProps) {
  const { t } = useTranslation()
  const { data: apiKeysData } = useProviderApiKeys(providerId)
  const { addApiKey, updateApiKey, deleteApiKey } = useProviderMutations(providerId)
  const { probe, results: probeResults, probeModelName } = useApiKeyProbe(providerId)
  const apiKeys = useMemo(() => apiKeysData?.keys ?? [], [apiKeysData?.keys])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  useEffect(() => {
    if (!open) {
      setEditingId(null)
      setDraft(null)
    }
  }, [open])

  const enabledCount = apiKeys.filter((item) => item.isEnabled).length

  const persist = useCallback(
    async (mutation: () => Promise<void>) => {
      if (savingRef.current) {
        return false
      }

      savingRef.current = true
      setSaving(true)
      try {
        await mutation()
        return true
      } catch (error) {
        logger.error('Failed to persist provider API keys', { providerId, error })
        toast.error(t('settings.provider.api_key.save_failed'))
        return false
      } finally {
        savingRef.current = false
        setSaving(false)
      }
    },
    [providerId, t]
  )

  const validateDraft = useCallback(
    (nextDraft: DraftState) => {
      const key = normalizeApiKeyValue(nextDraft.key)
      if (!key) {
        toast.warning(t('settings.provider.api.key.error.empty'))
        return null
      }

      const isDuplicate = apiKeys.some((item) => item.id !== nextDraft.id && item.key.trim() === key)
      if (isDuplicate) {
        toast.warning(t('settings.provider.api.key.error.duplicate'))
        return null
      }

      return key
    },
    [apiKeys, t]
  )

  const startAdd = useCallback(() => {
    const nextDraft = createEmptyDraft()
    setEditingId(nextDraft.id)
    setDraft(nextDraft)
  }, [])

  const startEdit = useCallback((entry: ApiKeyEntry) => {
    const nextDraft = toDraft(entry)
    setEditingId(nextDraft.id)
    setDraft(nextDraft)
  }, [])

  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setDraft(null)
  }, [])

  const saveDraft = useCallback(async () => {
    if (!draft) {
      return
    }

    const key = validateDraft(draft)
    if (!key) {
      return
    }

    const label = draft.label.trim()
    const saved = await persist(() =>
      draft.isNew ? addApiKey(key, label || undefined) : updateApiKey(draft.id, { key, label })
    )
    if (saved) {
      cancelEdit()
      // A key that was never exercised looks identical to a working one, which is how a
      // dead key gets discovered mid-conversation instead of here.
      void probe(key)
    }
  }, [addApiKey, cancelEdit, draft, persist, probe, updateApiKey, validateDraft])

  const removeKey = useCallback(
    async (id: string) => {
      if ((await persist(() => deleteApiKey(id))) && editingId === id) {
        cancelEdit()
      }
    },
    [cancelEdit, deleteApiKey, editingId, persist]
  )

  const toggleEnabled = useCallback(
    async (entry: ApiKeyEntry, isEnabled: boolean) => {
      await persist(() => updateApiKey(entry.id, { isEnabled }))
    },
    [persist, updateApiKey]
  )

  return (
    <ProviderSettingsDrawer
      open={open}
      onClose={onClose}
      title={t('settings.provider.api.key.list.title')}
      description={t('settings.provider.api_key.list_description')}
      footer={
        <div className={apiKeyListClasses.summaryMeta}>
          {enabledCount} / {apiKeys.length} {t('settings.provider.api_key.enabled_suffix')}
        </div>
      }>
      <div className="space-y-4">
        <div className={apiKeyListClasses.listWrap}>
          <Scrollbar className={apiKeyListClasses.listScroller}>
            {apiKeys.length === 0 && !draft ? (
              <div className="px-4 py-6 text-center text-muted-foreground text-sm">{t('error.no_api_key')}</div>
            ) : null}
            {apiKeys.map((entry) => (
              <div key={entry.id} className={apiKeyListClasses.keyRow}>
                {editingId === entry.id && draft ? (
                  <ApiKeyDraftRow
                    draft={draft}
                    saving={saving}
                    onChange={setDraft}
                    onSave={saveDraft}
                    onCancel={cancelEdit}
                  />
                ) : (
                  <ApiKeyDisplayRow
                    entry={entry}
                    saving={saving}
                    probe={probeResults[entry.key]}
                    probeModelName={probeModelName}
                    onProbe={() => void probe(entry.key)}
                    onEdit={() => startEdit(entry)}
                    onRemove={() => void removeKey(entry.id)}
                    onToggleEnabled={(next) => void toggleEnabled(entry, next)}
                  />
                )}
                {editingId === entry.id ? null : (
                  <>
                    <ApiKeyNote providerId={providerId} keyId={entry.id} note={entry.note} />
                    <ApiKeyQuotaLimit providerId={providerId} keyId={entry.id} />
                  </>
                )}
              </div>
            ))}
            {draft?.isNew ? (
              <div className={apiKeyListClasses.keyRow}>
                <ApiKeyDraftRow
                  draft={draft}
                  saving={saving}
                  onChange={setDraft}
                  onSave={saveDraft}
                  onCancel={cancelEdit}
                />
              </div>
            ) : null}
          </Scrollbar>
        </div>

        <Button className="w-full" variant="secondary" size="sm" disabled={!!draft || saving} onClick={startAdd}>
          <Plus size={14} />
          {t('settings.provider.api_setup.add_key')}
        </Button>

        {apiKeys.length > 1 ? <ApiKeyRotationPolicy providerId={providerId} /> : null}
      </div>
    </ProviderSettingsDrawer>
  )
}

interface ApiKeyDraftRowProps {
  draft: DraftState
  saving: boolean
  onChange: (draft: DraftState) => void
  onSave: () => void | Promise<void>
  onCancel: () => void
}

function ApiKeyDraftRow({ draft, saving, onChange, onSave, onCancel }: ApiKeyDraftRowProps) {
  const { t } = useTranslation()

  return (
    <div className={apiKeyListClasses.keyDraftRow}>
      <div className={apiKeyListClasses.keyDraftInputs}>
        <Input
          value={draft.label}
          placeholder={t('settings.provider.api_key.label_placeholder')}
          className={apiKeyListClasses.keyDraftInput}
          disabled={saving}
          onChange={(event) => onChange({ ...draft, label: event.target.value })}
        />
        <Input
          value={draft.key}
          placeholder={t('settings.provider.api.key.new_key.placeholder')}
          className={apiKeyListClasses.keyDraftInput}
          disabled={saving}
          spellCheck={false}
          autoFocus
          onChange={(event) => onChange({ ...draft, key: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void onSave()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              onCancel()
            }
          }}
        />
      </div>
      <div className={apiKeyListClasses.keyRowActions}>
        <Tooltip content={t('common.save')}>
          <button
            type="button"
            className={apiKeyListClasses.keySaveIconButton}
            aria-label={t('common.save')}
            disabled={saving}
            onClick={onSave}>
            <Check />
          </button>
        </Tooltip>
        <Tooltip content={t('common.cancel')}>
          <button
            type="button"
            className={apiKeyListClasses.keyDestructiveIconButton}
            aria-label={t('common.cancel')}
            disabled={saving}
            onClick={onCancel}>
            <X />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

interface ApiKeyDisplayRowProps {
  entry: ApiKeyEntry
  saving: boolean
  probe?: ApiKeyProbeState
  probeModelName?: string
  onProbe: () => void
  onEdit: () => void
  onRemove: () => void
  onToggleEnabled: (enabled: boolean) => void
}

function ApiKeyProbeBadge({ probe }: { probe: ApiKeyProbeState }) {
  const { t } = useTranslation()

  if (probe.status === 'probing') {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        {t('settings.provider.api_key.probe.running')}
      </span>
    )
  }

  if (probe.status === 'ok') {
    return (
      <span className="inline-flex items-center gap-1 text-success text-xs">
        <CheckCircle2 className="size-3" aria-hidden />
        {t('settings.provider.api_key.probe.ok', { latency: probe.latency })}
      </span>
    )
  }

  return (
    <Tooltip content={probe.message}>
      <span className="inline-flex items-center gap-1 text-destructive text-xs">
        <AlertCircle className="size-3" aria-hidden />
        {t('settings.provider.api_key.probe.failed')}
      </span>
    </Tooltip>
  )
}

function ApiKeyDisplayRow({
  entry,
  saving,
  probe,
  probeModelName,
  onProbe,
  onEdit,
  onRemove,
  onToggleEnabled
}: ApiKeyDisplayRowProps) {
  const { t } = useTranslation()
  const maskedKey = maskApiKey(entry.key)
  const handleCopy = useCallback(() => {
    void copyApiKeyToClipboard(entry.key, t)
  }, [entry.key, t])

  return (
    <div className={apiKeyListClasses.keyDisplayRow}>
      <div className={apiKeyListClasses.keyTextBlock}>
        {entry.label ? <div className={apiKeyListClasses.keyLabel}>{entry.label}</div> : null}
        <button
          type="button"
          title={t('settings.provider.api_key.copy')}
          className={`${apiKeyListClasses.keyValue} block cursor-pointer text-left transition-colors hover:text-foreground`}
          onClick={handleCopy}>
          {maskedKey === entry.key ? '••••••••' : maskedKey}
        </button>
        {probe ? <ApiKeyProbeBadge probe={probe} /> : null}
      </div>
      <div className={apiKeyListClasses.keyRowActions}>
        {probeModelName ? (
          <Tooltip content={t('settings.provider.api_key.probe.tooltip', { model: probeModelName })}>
            <button
              type="button"
              className={apiKeyListClasses.keyIconButton}
              aria-label={t('settings.provider.api_key.probe.action')}
              disabled={saving || probe?.status === 'probing'}
              onClick={onProbe}>
              <Zap />
            </button>
          </Tooltip>
        ) : null}
        <Tooltip content={t('settings.provider.api_key.copy')}>
          <button
            type="button"
            className={apiKeyListClasses.keyIconButton}
            aria-label={t('settings.provider.api_key.copy')}
            disabled={saving}
            onClick={handleCopy}>
            <Copy />
          </button>
        </Tooltip>
        <Tooltip content={t('common.edit')}>
          <button
            type="button"
            className={apiKeyListClasses.keyIconButton}
            aria-label={t('common.edit')}
            disabled={saving}
            onClick={onEdit}>
            <Edit3 />
          </button>
        </Tooltip>
        <Tooltip content={t('common.delete')}>
          <button
            type="button"
            className={apiKeyListClasses.keyDestructiveIconButton}
            aria-label={t('common.delete')}
            disabled={saving}
            onClick={onRemove}>
            <Trash2 />
          </button>
        </Tooltip>
        <Switch size="xs" checked={entry.isEnabled} disabled={saving} onCheckedChange={onToggleEnabled} />
      </div>
    </div>
  )
}
