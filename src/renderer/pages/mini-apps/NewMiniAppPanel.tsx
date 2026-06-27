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
import { useCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { LogoAvatar } from '@renderer/components/Icons'
import { getMiniAppsLogo } from '@renderer/config/miniApps'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { resolveStoredImageSrc, storeImageUpload } from '@renderer/utils/storedImage'
import { uuid } from '@renderer/utils/uuid'
import { MiniAppUrlSchema } from '@shared/data/api/schemas/miniApps'
import type { MiniApp } from '@shared/data/types/miniApp'
import { Upload } from 'lucide-react'
import type { ChangeEvent, FC } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  open: boolean
  app?: MiniApp | null
  onClose: () => void
}

const logger = loggerService.withContext('NewMiniAppPanel')

const NewMiniAppPanel: FC<Props> = ({ open, app, onClose }) => {
  const { t } = useTranslation()
  const { createCustomMiniApp, updateCustomMiniApp } = useMiniApps()
  const [filesPath] = useCache('app.path.files')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const uploadGenerationRef = useRef(0)
  const isEditing = app != null

  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  // `logo` is the preview value only (a preset id / url / object URL for a
  // staged upload). `logoUploadId` holds the pre-stored file-entry id submitted
  // as `logoFileId` on save; a non-upload submits the `'application'` default.
  const [logo, setLogo] = useState('')
  const [logoUploadId, setLogoUploadId] = useState<string | null>(null)
  const [logoChanged, setLogoChanged] = useState(false)
  const [logoProcessing, setLogoProcessing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // Object URL backing the upload preview; revoked when replaced/unmounted.
  const previewObjectUrlRef = useRef<string | null>(null)

  const revokePreviewObjectUrl = () => {
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current)
      previewObjectUrlRef.current = null
    }
  }

  useEffect(() => () => revokePreviewObjectUrl(), [])

  const reset = () => {
    uploadGenerationRef.current += 1
    setName('')
    setUrl('')
    setLogo('')
    revokePreviewObjectUrl()
    setLogoUploadId(null)
    setLogoChanged(false)
    setLogoProcessing(false)
  }

  useEffect(() => {
    uploadGenerationRef.current += 1
    setLogoChanged(false)
    setLogoProcessing(false)
    revokePreviewObjectUrl()
    setLogoUploadId(null)
    if (!open) {
      setName('')
      setUrl('')
      setLogo('')
      return
    }
    if (!app) {
      setName('')
      setUrl('')
      setLogo('')
      return
    }

    const currentLogo = app.logo ?? ''
    setName(app.name)
    setUrl(app.url)
    setLogo(currentLogo)
  }, [app, open])

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      handleClose()
    }
  }

  const canSubmit = useMemo(
    () => Boolean(name.trim() && url.trim()) && !submitting && !logoProcessing,
    [logoProcessing, name, submitting, url]
  )

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    const uploadGeneration = ++uploadGenerationRef.current
    setLogoProcessing(true)
    try {
      // Pre-store the normalized WebP to get an opaque file id (submitted as
      // logoFileId); preview the original file via an object URL.
      const fileId = await storeImageUpload(file)
      if (uploadGenerationRef.current !== uploadGeneration) return
      revokePreviewObjectUrl()
      previewObjectUrlRef.current = URL.createObjectURL(file)
      setLogo(previewObjectUrlRef.current)
      setLogoUploadId(fileId)
      setLogoChanged(true)
    } catch (error) {
      if (uploadGenerationRef.current !== uploadGeneration) return
      logger.error('Failed to process uploaded custom mini app logo', error as Error)
      window.toast.error(t('settings.miniApps.custom.logo_upload_error'))
    } finally {
      if (uploadGenerationRef.current === uploadGeneration) {
        setLogoProcessing(false)
      }
    }
  }

  const handleSubmit = async () => {
    const trimmedUrl = url.trim()
    if (!MiniAppUrlSchema.safeParse(trimmedUrl).success) {
      window.toast.error(t('settings.miniApps.custom.url_invalid'))
      return
    }

    setSubmitting(true)
    try {
      const basePayload = {
        name: name.trim(),
        url: trimmedUrl
      }
      // A staged upload submits its pre-stored file id (`kind: 'file'`);
      // otherwise the `'application'` preset key.
      const logo = logoUploadId
        ? ({ kind: 'file', fileId: logoUploadId } as const)
        : ({ kind: 'key', key: 'application' } as const)
      if (isEditing) {
        await updateCustomMiniApp(app.appId, logoChanged ? { ...basePayload, logo } : basePayload)
      } else {
        await createCustomMiniApp({
          appId: uuid(),
          ...basePayload,
          logo
        })
      }
      window.toast.success(t('settings.miniApps.custom.save_success'))
      handleClose()
    } catch (error) {
      window.toast.error(t('settings.miniApps.custom.save_error'))
      logger.error('Failed to save custom mini app:', error as Error)
    } finally {
      setSubmitting(false)
    }
  }

  const hasUploadedLogo = logoUploadId != null
  const logoValue = logo.trim() || 'application'
  // Resolve a stored file id (an existing app's uploaded logo) to a file:// URL;
  // preset ids resolve to their CompoundIcon, object URLs / urls pass through.
  const previewLogo = getMiniAppsLogo(logoValue) ?? resolveStoredImageSrc(logoValue, filesPath)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t(isEditing ? 'settings.miniApps.custom.edit_title' : 'settings.miniApps.custom.create_title')}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <Field>
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => fileInputRef.current?.click()}
                aria-label={t('settings.miniApps.custom.logo_upload_label')}>
                <LogoAvatar logo={previewLogo} size={64} />
              </button>
              <div className="flex flex-wrap gap-2">
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
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
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
