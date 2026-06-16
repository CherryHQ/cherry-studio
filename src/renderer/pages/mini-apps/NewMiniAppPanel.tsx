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
import { LogoAvatar } from '@renderer/components/Icons'
import { getMiniAppsLogo } from '@renderer/config/miniApps'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { uuid } from '@renderer/utils'
import { compressImage, convertToBase64 } from '@renderer/utils/image'
import { MINI_APP_LOGO_MAX_LENGTH, MiniAppUrlSchema } from '@shared/data/api/schemas/miniApps'
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
const miniAppLogoCompressionOptions = {
  maxSizeMB: 0.25,
  maxWidthOrHeight: 256,
  useWebWorker: false
} as const

const NewMiniAppPanel: FC<Props> = ({ open, app, onClose }) => {
  const { t } = useTranslation()
  const { createCustomMiniApp, updateCustomMiniApp } = useMiniApps()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const uploadGenerationRef = useRef(0)
  const isEditing = app != null

  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [logo, setLogo] = useState('')
  const [logoChanged, setLogoChanged] = useState(false)
  const [logoProcessing, setLogoProcessing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const reset = () => {
    uploadGenerationRef.current += 1
    setName('')
    setUrl('')
    setLogo('')
    setLogoChanged(false)
    setLogoProcessing(false)
  }

  useEffect(() => {
    uploadGenerationRef.current += 1
    setLogoChanged(false)
    setLogoProcessing(false)
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
      const processedFile = file.type === 'image/gif' ? file : await compressImage(file, miniAppLogoCompressionOptions)
      const encoded = await convertToBase64(processedFile)
      if (typeof encoded !== 'string' || encoded.length > MINI_APP_LOGO_MAX_LENGTH) {
        throw new Error('MiniApp logo exceeds max payload size')
      }
      if (uploadGenerationRef.current !== uploadGeneration) return
      setLogo(encoded)
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
      if (isEditing) {
        await updateCustomMiniApp(
          app.appId,
          logoChanged ? { ...basePayload, logo: logo.trim() || 'application' } : basePayload
        )
      } else {
        await createCustomMiniApp({
          appId: uuid(),
          ...basePayload,
          logo: logo.trim() || 'application'
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

  const hasUploadedLogo = logo.startsWith('data:')
  const logoValue = logo.trim() || 'application'
  const previewLogo = getMiniAppsLogo(logoValue) ?? logoValue

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
