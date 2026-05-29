import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { PRESETS_MINI_APPS } from '@shared/data/presets/mini-apps'
import { Upload } from 'lucide-react'
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
  const { miniApps, disabled, pinned, createCustomMiniApp } = useMiniApps()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [logo, setLogo] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const reset = () => {
    setId('')
    setName('')
    setUrl('')
    setLogo('')
    setLogoUrl('')
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      handleClose()
    }
  }

  const canSubmit = useMemo(() => id.trim() && name.trim() && url.trim() && !submitting, [id, name, url, submitting])

  const existingAppIds = useMemo(
    () => new Set([...miniApps, ...disabled, ...pinned].map((a) => a.appId)),
    [miniApps, disabled, pinned]
  )

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const data = event.target?.result
      if (typeof data === 'string') {
        setLogo(data)
        setLogoUrl('')
        window.toast.success(t('settings.miniApps.custom.logo_upload_success'))
      }
    }
    reader.onerror = () => window.toast.error(t('settings.miniApps.custom.logo_upload_error'))
    reader.readAsDataURL(file)
    e.target.value = ''
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

  const hasUploadedLogo = logo.startsWith('data:') && !logoUrl

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('settings.miniApps.custom.edit_title')}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
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
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor="miniapp-logo">{t('settings.miniApps.custom.logo')}</FieldLabel>
              <Button
                type="button"
                size="sm"
                variant={hasUploadedLogo ? 'secondary' : 'outline'}
                onClick={() => fileInputRef.current?.click()}
                className="gap-1.5">
                <Upload size={12} />
                {t('settings.miniApps.custom.logo_file')}
              </Button>
            </div>
            <Input
              id="miniapp-logo"
              value={logoUrl}
              onChange={(e) => {
                setLogoUrl(e.target.value)
                setLogo(e.target.value)
              }}
              placeholder={t('settings.miniApps.custom.logo_url_placeholder')}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
              aria-label={t('settings.miniApps.custom.logo_upload_label')}
            />
          </Field>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t('common.cancel')}</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default NewMiniAppPanel
