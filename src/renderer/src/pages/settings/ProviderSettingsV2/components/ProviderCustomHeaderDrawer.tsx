import { Button } from '@cherrystudio/ui'
import { useCopilot } from '@renderer/hooks/useCopilot'
import { useProvider } from '@renderer/hooks/useProviders'
import { Plus, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { applyProviderCustomHeaderSideEffects } from '../adapters/providerSettingsSideEffects'
import ProviderSettingsDrawer from './ProviderSettingsDrawer'
import { customHeaderDrawerClasses, modelListClasses } from './ProviderSettingsPrimitives'

interface ProviderCustomHeaderDrawerProps {
  providerId: string
  open: boolean
  onClose: () => void
}

interface HeaderRow {
  id: string
  key: string
  value: string
}

function newRow(partial?: Partial<Pick<HeaderRow, 'key' | 'value'>>): HeaderRow {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return { id, key: partial?.key ?? '', value: partial?.value ?? '' }
}

function headersObjectToRows(obj: Record<string, string>): HeaderRow[] {
  const entries = Object.entries(obj)
  if (entries.length === 0) {
    return []
  }
  return entries.map(([key, value]) => newRow({ key, value }))
}

function rowsToHeadersObject(rows: HeaderRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of rows) {
    const k = row.key.trim()
    if (!k) {
      continue
    }
    out[k] = row.value
  }
  return out
}

export default function ProviderCustomHeaderDrawer({ providerId, open, onClose }: ProviderCustomHeaderDrawerProps) {
  const { t } = useTranslation()
  const { provider, updateProvider } = useProvider(providerId)
  const { defaultHeaders, updateDefaultHeaders } = useCopilot()

  const sourceHeaders = useMemo<Record<string, string>>(
    () => (providerId === 'copilot' ? { ...(defaultHeaders ?? {}) } : { ...(provider?.settings?.extraHeaders ?? {}) }),
    [defaultHeaders, provider?.settings?.extraHeaders, providerId]
  )

  const [rows, setRows] = useState<HeaderRow[]>([])

  useEffect(() => {
    if (!open) {
      return
    }
    setRows(headersObjectToRows(sourceHeaders))
  }, [open, sourceHeaders])

  const handleSave = useCallback(async () => {
    const parsedHeaders = rowsToHeadersObject(rows)

    applyProviderCustomHeaderSideEffects({
      providerId,
      headers: parsedHeaders,
      updateCopilotHeaders: updateDefaultHeaders
    })

    await updateProvider({ providerSettings: { ...provider?.settings, extraHeaders: parsedHeaders } })

    window.toast.success(t('message.save.success.title'))
    onClose()
  }, [onClose, provider?.settings, providerId, rows, t, updateDefaultHeaders, updateProvider])

  const headerTitle = (
    <div className={customHeaderDrawerClasses.headerTitleRow}>
      <span className={customHeaderDrawerClasses.headerTitleText}>{t('settings.provider.copilot.custom_headers')}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={modelListClasses.manageDrawerCloseInTitle}
        onClick={onClose}
        aria-label={t('common.close')}>
        <X aria-hidden className="size-[11px]" />
      </Button>
    </div>
  )

  const footer = (
    <div className="flex items-center justify-end gap-2">
      <Button type="button" variant="outline" className={customHeaderDrawerClasses.footerOutlineBtn} onClick={onClose}>
        {t('common.cancel')}
      </Button>
      <Button type="button" className={customHeaderDrawerClasses.footerPrimaryBtn} onClick={() => void handleSave()}>
        {t('common.save')}
      </Button>
    </div>
  )

  return (
    <ProviderSettingsDrawer
      open={open}
      onClose={onClose}
      title={headerTitle}
      footer={footer}
      size="manage"
      showHeaderCloseButton={false}
      contentClassName="!w-[min(280px,calc(100vw-1.5rem))]">
      <div className={customHeaderDrawerClasses.bodyScroll}>
        {rows.map((row) => (
          <div key={row.id} className={customHeaderDrawerClasses.card}>
            <div className={customHeaderDrawerClasses.cardRow}>
              <label className={customHeaderDrawerClasses.cardRowLabel} htmlFor={`provider-hdr-key-${row.id}`}>
                {t('settings.provider.copilot.header_field_name')}
              </label>
              <input
                id={`provider-hdr-key-${row.id}`}
                className={customHeaderDrawerClasses.cardInput}
                value={row.key}
                onChange={(e) => {
                  const v = e.target.value
                  setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, key: v } : r)))
                }}
                placeholder={t('settings.provider.copilot.header_name_placeholder')}
                autoComplete="off"
              />
            </div>
            <div className={customHeaderDrawerClasses.cardRow}>
              <label className={customHeaderDrawerClasses.cardRowLabel} htmlFor={`provider-hdr-val-${row.id}`}>
                {t('settings.provider.copilot.header_field_value')}
              </label>
              <input
                id={`provider-hdr-val-${row.id}`}
                className={customHeaderDrawerClasses.cardInput}
                value={row.value}
                onChange={(e) => {
                  const v = e.target.value
                  setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, value: v } : r)))
                }}
                placeholder={t('settings.provider.copilot.header_value_placeholder')}
                autoComplete="off"
              />
            </div>
            <div className={customHeaderDrawerClasses.cardRemoveRow}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={customHeaderDrawerClasses.removeIconButton}
                onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                aria-label={t('common.delete')}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          className={customHeaderDrawerClasses.addRowButton}
          onClick={() => setRows((prev) => [...prev, newRow()])}>
          <Plus className="size-2.5 shrink-0" aria-hidden />
          <span>{t('settings.provider.copilot.add_request_header')}</span>
        </Button>
      </div>
    </ProviderSettingsDrawer>
  )
}
