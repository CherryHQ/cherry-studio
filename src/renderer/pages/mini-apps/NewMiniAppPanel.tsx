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
import { fileToAvatarDataUrl } from '@renderer/utils/image'
import { PRESETS_MINI_APPS } from '@shared/data/presets/miniApps'
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

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      // Normalize the upload (non-GIF → ≤128px, oversized GIFs rejected) so the
      // stored logo string stays small instead of encoding the original image.
      const dataUrl = await fileToAvatarDataUrl(file)
      setLogo(dataUrl)
      setLogoUrl('')
      window.toast.success(t('settings.miniApps.custom.logo_upload_success'))
    } catch (error) {
      logger.error('Failed to process uploaded mini app logo', error as Error)
      const message =
        error instanceof Error && error.message ? error.message : t('settings.miniApps.custom.logo_upload_error')
      window.toast.error(message)
    }
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
            <FieldLabel htmlFor="miniapp-id" required>
              {t('settings.miniApps.custom.id')}
            </FieldLabel>
            <Input
              id="miniapp-id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder={t('settings.miniApps.custom.id_placeholder')}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="miniapp-name" required>
              {t('settings.miniApps.custom.name')}
            </FieldLabel>
            <Input
              id="miniapp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('settings.miniApps.custom.name_placeholder')}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="miniapp-url" required>
              {t('settings.miniApps.custom.url')}
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
              onChange={(e) => void handleFileChange(e)}
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
