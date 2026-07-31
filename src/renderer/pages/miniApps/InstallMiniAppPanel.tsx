import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Alert,
  Button,
  DialogFooter,
  Field,
  FieldLabel,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@cherrystudio/ui'
import { InstallConsentDialog } from '@renderer/components/MiniApp/InstallConsentDialog'
import { useMiniAppInstallPreview } from '@renderer/hooks/useMiniAppInstallPreview'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'

/** Enough shape to be worth a request: a scheme and a host. Main still decides https and the rest. */
const looksLikeUrl = (value: string): boolean => {
  try {
    const url = new URL(value.trim())
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.length > 0
  } catch {
    return false
  }
}

/**
 * The "local mini app" tab of the add dialog: pick a package file, or load one by
 * address. Either opens the consent dialog on top; installing closes the add dialog.
 */
export const InstallMiniAppPicker: FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation()
  const [manifestUrl, setManifestUrl] = useState('')
  const { preview, busy, error, settle, cancelPreview, confirm } = useMiniAppInstallPreview(onClose)

  const handlePick = () =>
    settle(() => ipcApi.request('mini_app.install.pick_and_preview'), 'miniApp.install.preview_error')

  // One address: the user types whichever mirror they can reach, and the manifest itself
  // names the pair every later fetch chooses between.
  const handlePreviewUrl = () =>
    settle(
      () => ipcApi.request('mini_app.install.preview_url', { manifestUrl: manifestUrl.trim() }),
      'miniApp.install.url_preview_error'
    )

  return (
    <>
      <div className="flex flex-col gap-4 py-4">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-5">
          <p className="text-center text-muted-foreground text-sm">{t('miniApp.install.pick_hint')}</p>
          <Button variant="outline" onClick={handlePick} disabled={busy}>
            {t('miniApp.install.choose_file')}
          </Button>
        </div>

        <Field>
          <FieldLabel htmlFor="miniapp-install-url">{t('miniApp.install.url_section')}</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="miniapp-install-url"
              value={manifestUrl}
              onChange={(e) => setManifestUrl(e.target.value)}
              placeholder={t('miniApp.install.url_placeholder')}
            />
            {/* The action appears once the address has a shape: a request for "h" can only fail. */}
            {looksLikeUrl(manifestUrl) && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton variant="default" onClick={handlePreviewUrl} disabled={busy}>
                  {t('miniApp.install.url_load')}
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
        </Field>

        {error && <Alert type="error" message={t(error.key, error.params)} />}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </DialogFooter>

      {preview && <InstallConsentDialog preview={preview} busy={busy} onCancel={cancelPreview} onConfirm={confirm} />}
    </>
  )
}

/**
 * A builtin tile's "install": previews that app on mount and shows nothing but the
 * consent dialog. A preview that fails has no picker to report into, so it toasts.
 */
const InstallMiniAppPanel: FC<{ builtinAppId: string; onClose?: () => void }> = ({ builtinAppId, onClose }) => {
  const { t } = useTranslation()
  const done = useCallback(() => onClose?.(), [onClose])
  const { preview, busy, error, settle, cancelPreview, confirm } = useMiniAppInstallPreview(done)

  useEffect(() => {
    void settle(
      () => ipcApi.request('mini_app.install.preview_builtin', { appId: builtinAppId }),
      'miniApp.install.preview_error'
    )
  }, [builtinAppId, settle])

  useEffect(() => {
    if (!error) return
    toast.error(t(error.key, error.params))
    done()
  }, [done, error, t])

  if (!preview) return null
  return (
    <InstallConsentDialog
      preview={preview}
      busy={busy}
      onCancel={() => {
        cancelPreview()
        done()
      }}
      onConfirm={confirm}
    />
  )
}

export default InstallMiniAppPanel
