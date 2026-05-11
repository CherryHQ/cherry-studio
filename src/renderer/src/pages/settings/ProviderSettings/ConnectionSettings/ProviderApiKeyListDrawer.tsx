import { Button, Switch, Tooltip } from '@cherrystudio/ui'
import { useProviderApiKeys, useProviderMutations } from '@renderer/hooks/useProviders'
import { maskApiKey } from '@renderer/utils/api'
import type { ApiKeyEntry } from '@shared/data/types/provider'
import { Check, Copy, Edit3, Minus, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderSettingsDrawer from '../primitives/ProviderSettingsDrawer'
import { apiKeyListClasses } from '../primitives/ProviderSettingsPrimitives'
import { copyApiKeyToClipboard } from './copyApiKeyToClipboard'

interface ProviderApiKeyListDrawerProps {
  providerId: string
  open: boolean
  onClose: () => void
}

interface DraftState {
  id: string
  key: string
  label: string
  isEnabled: boolean
  isNew: boolean
}

const createEmptyDraft = (): DraftState => ({
  id: crypto.randomUUID(),
  key: '',
  label: '',
  isEnabled: true,
  isNew: true
})

function normalizeApiKeyValue(value: string) {
  return value.trim()
}

function toDraft(entry: ApiKeyEntry): DraftState {
  return {
    id: entry.id,
    key: entry.key,
    label: entry.label ?? '',
    isEnabled: entry.isEnabled,
    isNew: false
  }
}

function toEntry(draft: DraftState): ApiKeyEntry {
  return {
    id: draft.id,
    key: normalizeApiKeyValue(draft.key),
    label: draft.label.trim() || undefined,
    isEnabled: draft.isEnabled
  }
}

export default function ProviderApiKeyListDrawer({ providerId, open, onClose }: ProviderApiKeyListDrawerProps) {
  const { t } = useTranslation()
  const { data: apiKeysData } = useProviderApiKeys(providerId)
  const { updateApiKeys } = useProviderMutations(providerId)
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
    async (nextKeys: ApiKeyEntry[]) => {
      if (savingRef.current) {
        return false
      }

      savingRef.current = true
      setSaving(true)
      try {
        await updateApiKeys(nextKeys)
        return true
      } catch {
        window.toast.error(t('settings.provider.api_key.save_failed'))
        return false
      } finally {
        savingRef.current = false
        setSaving(false)
      }
    },
    [t, updateApiKeys]
  )

  const validateDraft = useCallback(
    (nextDraft: DraftState) => {
      const key = normalizeApiKeyValue(nextDraft.key)
      if (!key) {
        window.toast.warning(t('settings.provider.api.key.error.empty'))
        return null
      }

      const isDuplicate = apiKeys.some((item) => item.id !== nextDraft.id && item.key.trim() === key)
      if (isDuplicate) {
        window.toast.warning(t('settings.provider.api.key.error.duplicate'))
        return null
      }

      return toEntry(nextDraft)
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

    const entry = validateDraft(draft)
    if (!entry) {
      return
    }

    const nextKeys = draft.isNew ? [...apiKeys, entry] : apiKeys.map((item) => (item.id === entry.id ? entry : item))
    if (await persist(nextKeys)) {
      cancelEdit()
    }
  }, [apiKeys, cancelEdit, draft, persist, validateDraft])

  const removeKey = useCallback(
    async (id: string) => {
      if ((await persist(apiKeys.filter((item) => item.id !== id))) && editingId === id) {
        cancelEdit()
      }
    },
    [apiKeys, cancelEdit, editingId, persist]
  )

  const toggleEnabled = useCallback(
    async (entry: ApiKeyEntry, isEnabled: boolean) => {
      await persist(apiKeys.map((item) => (item.id === entry.id ? { ...item, isEnabled } : item)))
    },
    [apiKeys, persist]
  )

  return (
    <ProviderSettingsDrawer
      open={open}
      onClose={onClose}
      title={t('settings.provider.api.key.list.title')}
      description={t('settings.provider.api_key.list_description')}
      size="wide"
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className={apiKeyListClasses.summaryMeta}>
            {enabledCount} / {apiKeys.length} {t('settings.provider.api_key.enabled_suffix')}
          </div>
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      }>
      <div className={apiKeyListClasses.shell}>
        <div className={apiKeyListClasses.listWrap}>
          <div className={apiKeyListClasses.listScroller}>
            {apiKeys.length === 0 && !draft ? (
              <div className="px-4 py-6 text-center text-[length:var(--font-size-body-md)] text-muted-foreground/70">
                {t('error.no_api_key')}
              </div>
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
                    onEdit={() => startEdit(entry)}
                    onRemove={() => void removeKey(entry.id)}
                    onToggleEnabled={(next) => void toggleEnabled(entry, next)}
                  />
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
          </div>
        </div>

        <div className={apiKeyListClasses.actionRow}>
          <div className={apiKeyListClasses.helperText}>{t('settings.provider.api_key.tip')}</div>
          <Button
            className={apiKeyListClasses.addButton}
            variant="outline"
            disabled={!!draft || saving}
            onClick={startAdd}>
            <Plus size={14} />
            {t('common.add')}
          </Button>
        </div>
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
    <div className="space-y-2">
      <div className={apiKeyListClasses.keyInputRow}>
        <input
          className={apiKeyListClasses.input}
          value={draft.label}
          placeholder={t('settings.provider.api_key.label_placeholder')}
          disabled={saving}
          onChange={(event) => onChange({ ...draft, label: event.target.value })}
        />
        <input
          className={apiKeyListClasses.input}
          value={draft.key}
          placeholder={t('settings.provider.api.key.new_key.placeholder')}
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
      <div className={apiKeyListClasses.actionRow}>
        <label className="flex items-center gap-2 text-[length:var(--font-size-body-xs)] text-muted-foreground">
          <Switch
            checked={draft.isEnabled}
            disabled={saving}
            onCheckedChange={(isEnabled) => onChange({ ...draft, isEnabled })}
          />
          {t('common.enabled')}
        </label>
        <div className={apiKeyListClasses.actionCluster}>
          <Button variant="ghost" size="icon-sm" disabled={saving} onClick={onSave}>
            <Check size={14} />
          </Button>
          <Button variant="ghost" size="icon-sm" disabled={saving} onClick={onCancel}>
            <X size={14} />
          </Button>
        </div>
      </div>
    </div>
  )
}

interface ApiKeyDisplayRowProps {
  entry: ApiKeyEntry
  saving: boolean
  onEdit: () => void
  onRemove: () => void
  onToggleEnabled: (enabled: boolean) => void
}

function ApiKeyDisplayRow({ entry, saving, onEdit, onRemove, onToggleEnabled }: ApiKeyDisplayRowProps) {
  const { t } = useTranslation()
  const handleCopy = useCallback(() => {
    void copyApiKeyToClipboard(entry.key, t)
  }, [entry.key, t])

  return (
    <>
      <div className={apiKeyListClasses.keyRowHeader}>
        <div className="min-w-0 flex-1">
          <div className={apiKeyListClasses.keyLabel}>{entry.label || t('settings.provider.api_key.unnamed')}</div>
          <button
            type="button"
            title={t('settings.provider.api_key.copy')}
            className={`${apiKeyListClasses.keyValue} block cursor-pointer text-left transition-colors hover:text-foreground/85`}
            onClick={handleCopy}>
            {maskApiKey(entry.key)}
          </button>
        </div>
        <Switch checked={entry.isEnabled} disabled={saving} onCheckedChange={onToggleEnabled} />
      </div>
      <div className="flex items-center justify-end gap-1">
        <Tooltip content={t('settings.provider.api_key.copy')}>
          <Button variant="ghost" size="icon-sm" disabled={saving} onClick={handleCopy}>
            <Copy size={14} />
          </Button>
        </Tooltip>
        <Tooltip content={t('common.edit')}>
          <Button variant="ghost" size="icon-sm" disabled={saving} onClick={onEdit}>
            <Edit3 size={14} />
          </Button>
        </Tooltip>
        <Tooltip content={t('common.delete')}>
          <Button variant="ghost" size="icon-sm" disabled={saving} onClick={onRemove}>
            <Minus size={14} />
          </Button>
        </Tooltip>
      </div>
    </>
  )
}
