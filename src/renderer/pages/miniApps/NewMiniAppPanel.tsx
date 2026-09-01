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
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import MiniAppLogoAvatar from '@renderer/components/icons/MiniAppLogoAvatar'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { checkEntityImageSize, prepareEntityImageBytes } from '@renderer/utils/image'
import { uuid } from '@renderer/utils/uuid'
import { MiniAppUrlSchema } from '@shared/data/api/schemas/miniApps'
import type { MiniApp } from '@shared/data/types/miniApp'
import { ExternalLink, Globe, Package, Upload } from 'lucide-react'
import type { ChangeEvent, FC } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InstallMiniAppPicker } from './InstallMiniAppPanel'

interface Props {
  open: boolean
  app?: MiniApp | null
  onClose: () => void
}

type AddTab = 'site' | 'app'

const logger = loggerService.withContext('NewMiniAppPanel')
const MINI_APP_DEVELOPER_DOCS_URL = 'https://github.com/CherryHQ/cherry-studio-miniapps'

/**
 * The one "add" dialog. Creating offers two tabs — a custom website, or an installed
 * mini app package — while editing an existing site shows its form alone.
 */
const NewMiniAppPanel: FC<Props> = ({ open, app, onClose }) => {
  const { t } = useTranslation()
  const { createCustomMiniApp, refreshCustomMiniApp, updateCustomMiniApp } = useMiniApps()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const isEditing = app != null

  const [tab, setTab] = useState<AddTab>('site')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  // `logo` is the preview value only (a preset id / url / object URL for a
  // staged upload). `stagedFile` holds a newly picked image; on save its bytes
  // are uploaded via the `mini_app.settings.set_logo` command. A non-upload keeps the default.
  const [logo, setLogo] = useState('')
  const [stagedFile, setStagedFile] = useState<File | null>(null)
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
    setName('')
    setUrl('')
    setLogo('')
    revokePreviewObjectUrl()
    setStagedFile(null)
  }

  useEffect(() => {
    revokePreviewObjectUrl()
    setStagedFile(null)
    setTab('site')
    if (!open || !app) {
      setName('')
      setUrl('')
      setLogo('')
      return
    }
    setName(app.name)
    setUrl(app.url)
    // Preset key or an existing uploaded logo's main-resolved URL.
    setLogo(app.logo ?? app.logoSrc ?? '')
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

  const canSubmit = useMemo(() => Boolean(name.trim() && url.trim()) && !submitting, [name, submitting, url])

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const sizeError = checkEntityImageSize(file)
    if (sizeError) {
      toast.error(sizeError)
      return
    }
    // Stage the raw file + preview it; the bytes are uploaded on save via the
    // `mini_app.settings.set_logo` command (the renderer no longer creates file_entries).
    revokePreviewObjectUrl()
    previewObjectUrlRef.current = URL.createObjectURL(file)
    setLogo(previewObjectUrlRef.current)
    setStagedFile(file)
  }

  const handleSubmit = async () => {
    const trimmedUrl = url.trim()
    if (!MiniAppUrlSchema.safeParse(trimmedUrl).success) {
      toast.error(t('settings.miniApps.custom.url_invalid'))
      return
    }

    setSubmitting(true)
    const basePayload = { name: name.trim(), url: trimmedUrl }
    const appId = app ? app.appId : uuid()
    try {
      if (isEditing) {
        await updateCustomMiniApp(appId, basePayload)
      } else {
        // Create with the default preset logo; a staged upload replaces it below.
        await createCustomMiniApp({ appId, ...basePayload, logo: { kind: 'key', key: 'application' } })
      }
    } catch (error) {
      toast.error(t('settings.miniApps.custom.save_error'))
      logger.error('Failed to save custom mini app:', error as Error)
      setSubmitting(false)
      return
    }

    // Logo upload is a separate command (bytes → file_entry main-side). The row
    // is already saved, so a logo failure is NON-fatal: surface a logo-specific
    // message but still close the dialog. Returning here instead would leave the
    // dialog in create mode, and a second Save would mint a fresh appId and
    // insert a duplicate row (mirrors the provider flow's non-fatal applyLogo).
    let logoFailed = false
    if (stagedFile) {
      try {
        const data = await prepareEntityImageBytes(stagedFile)
        await ipcApi.request('mini_app.settings.set_logo', { appId, image: { kind: 'image', data } })
        await refreshCustomMiniApp(appId)
      } catch (error) {
        logoFailed = true
        toast.error(t('settings.miniApps.custom.logo_upload_error'))
        logger.error('Failed to set custom mini app logo:', error as Error)
      }
    }

    if (!logoFailed) {
      toast.success(t('settings.miniApps.custom.save_success'))
    }
    handleClose()
    setSubmitting(false)
  }

  const hasUploadedLogo = stagedFile != null
  const logoValue = logo.trim() || 'application'

  const siteForm = (
    <>
      <div className="grid gap-4 py-4">
        <Field>
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              className="rounded-md outline-none transition-opacity focus-visible:opacity-80"
              onClick={() => fileInputRef.current?.click()}
              aria-label={t('settings.miniApps.custom.logo_upload_label')}>
              <MiniAppLogoAvatar logo={logoValue} size={64} alt="" />
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
    </>
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent closeOnOverlayClick={false} aria-describedby={undefined} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(isEditing ? 'settings.miniApps.custom.edit_title' : 'miniApp.add.title')}</DialogTitle>
        </DialogHeader>

        {isEditing ? (
          siteForm
        ) : (
          <Tabs value={tab} onValueChange={(value) => setTab(value as AddTab)}>
            <TabsList className="w-full">
              <TabsTrigger value="site" className="flex-1">
                <Globe className="size-4" />
                {t('miniApp.add.tab_site')}
              </TabsTrigger>
              <TabsTrigger value="app" className="flex-1">
                <Package className="size-4" />
                {t('miniApp.add.tab_app')}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="site">{siteForm}</TabsContent>
            {/* Mounted only while chosen: its unmount releases any pending consent token. */}
            {tab === 'app' && (
              <TabsContent value="app">
                <div className="mt-3 flex items-center gap-3 rounded-lg bg-muted px-3 py-2.5">
                  <Package className="size-4 shrink-0 text-muted-foreground" />
                  <p className="min-w-0 flex-1 text-sm">{t('miniApp.add.app_description')}</p>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="shrink-0 px-0 text-link shadow-none hover:text-link focus-visible:text-link"
                    onClick={() => void ipcApi.request('system.shell.open_website', MINI_APP_DEVELOPER_DOCS_URL)}>
                    {t('miniApp.add.developer_docs')}
                    <ExternalLink className="size-3.5" />
                  </Button>
                </div>
                <InstallMiniAppPicker onClose={handleClose} />
              </TabsContent>
            )}
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default NewMiniAppPanel
