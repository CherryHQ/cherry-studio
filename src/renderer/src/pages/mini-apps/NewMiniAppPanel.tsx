import { Button, Field, FieldLabel, Input, PageSidePanel } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { LogoAvatar } from '@renderer/components/Icons'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { PRESETS_MINI_APPS } from '@shared/data/presets/mini-apps'
import { Link2, Upload } from 'lucide-react'
import type { ChangeEvent, FC } from 'react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  open: boolean
  onClose: () => void
}

const logger = loggerService.withContext('NewMiniAppPanel')

const NewMiniAppPanel: FC<Props> = ({ open, onClose }) => {
  const { t } = useTranslation()
  const { miniapps, disabled, pinned, createCustomMiniApp } = useMiniApps()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [logo, setLogo] = useState('')
  const [logoMode, setLogoMode] = useState<'url' | 'file'>('url')
  const [submitting, setSubmitting] = useState(false)

  const reset = () => {
    setId('')
    setName('')
    setUrl('')
    setLogo('')
    setLogoMode('url')
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const canSubmit = useMemo(() => id.trim() && name.trim() && url.trim() && !submitting, [id, name, url, submitting])

  const existingAppIds = useMemo(
    () => new Set([...miniapps, ...disabled, ...pinned].map((a) => a.appId)),
    [miniapps, disabled, pinned]
  )

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const data = event.target?.result
      if (typeof data === 'string') {
        setLogo(data)
        window.toast.success(t('settings.miniApps.custom.logo_upload_success'))
      }
    }
    reader.onerror = () => window.toast.error(t('settings.miniApps.custom.logo_upload_error'))
    reader.readAsDataURL(file)
  }

  const handleSubmit = async () => {
    const trimmedId = id.trim()
    if (PRESETS_MINI_APPS.some((app) => app.id === trimmedId)) {
      window.toast.error(t('settings.miniApps.custom.conflicting_ids', { ids: trimmedId }))
      return
    }
    if (existingAppIds.has(trimmedId)) {
      window.toast.error(t('settings.miniApps.custom.duplicate_ids', { ids: trimmedId }))
      return
    }
    setSubmitting(true)
    try {
      await createCustomMiniApp({
        appId: trimmedId,
        name: name.trim(),
        url: url.trim(),
        logo: logo.trim() || 'application',
        bordered: false,
        supportedRegions: ['CN', 'Global']
      })
      window.toast.success(t('settings.miniApps.custom.save_success'))
      handleClose()
    } catch (error) {
      window.toast.error(t('settings.miniApps.custom.save_error'))
      logger.error('Failed to save custom mini app:', error as Error)
    } finally {
      setSubmitting(false)
    }
  }

  const header = <span className="text-[12px] text-foreground">{t('settings.miniApps.custom.edit_title')}</span>

  const footer = (
    <div className="flex items-center justify-end gap-2">
      <Button variant="ghost" size="sm" onClick={handleClose}>
        {t('common.cancel')}
      </Button>
      <Button variant="default" size="sm" onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>
        {t('common.save')}
      </Button>
    </div>
  )

  return (
    <PageSidePanel open={open} onClose={handleClose} header={header} footer={footer} closeLabel={t('common.close')}>
      <div className="flex flex-col items-center gap-1 pb-4">
        <LogoAvatar logo={logo || undefined} size={64} />
        <span className="text-[11px] text-muted-foreground/60">{name.trim() || t('common.unnamed')}</span>
      </div>

      <Field>
        <FieldLabel htmlFor="miniapp-id">
          <span className="text-destructive">*</span> {t('settings.miniApps.custom.id')}
        </FieldLabel>
        <Input
          id="miniapp-id"
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder={t('settings.miniApps.custom.id_placeholder')}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="miniapp-name">
          <span className="text-destructive">*</span> {t('settings.miniApps.custom.name')}
        </FieldLabel>
        <Input
          id="miniapp-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('settings.miniApps.custom.name_placeholder')}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="miniapp-url">
          <span className="text-destructive">*</span> {t('settings.miniApps.custom.url')}
        </FieldLabel>
        <Input
          id="miniapp-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t('settings.miniApps.custom.url_placeholder')}
        />
      </Field>

      <Field>
        <FieldLabel>{t('settings.miniApps.custom.logo')}</FieldLabel>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={logoMode === 'url' ? 'secondary' : 'ghost'}
            onClick={() => setLogoMode('url')}
            className="gap-1.5">
            <Link2 size={12} />
            {t('settings.miniApps.custom.logo_url')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={logoMode === 'file' ? 'secondary' : 'ghost'}
            onClick={() => {
              setLogoMode('file')
              fileInputRef.current?.click()
            }}
            className="gap-1.5">
            <Upload size={12} />
            {t('settings.miniApps.custom.logo_file')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
            aria-label={t('settings.miniApps.custom.logo_upload_label')}
          />
        </div>
        {logoMode === 'url' && (
          <Input
            value={logo}
            onChange={(e) => setLogo(e.target.value)}
            placeholder={t('settings.miniApps.custom.logo_url_placeholder')}
          />
        )}
      </Field>
    </PageSidePanel>
  )
}

export default NewMiniAppPanel
