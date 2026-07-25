import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useTheme } from '@renderer/hooks/useTheme'
import { ipcApi } from '@renderer/ipc'
import { joinPath } from '@renderer/utils/path'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import type { FilePath } from '@shared/types/file'
import { toFileUrl } from '@shared/utils/file'
import { LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('PrivacyPolicyDialog')

export function getPrivacyPolicyAsset(language: string): 'privacy-en.html' | 'privacy-zh.html' {
  return language.toLowerCase().startsWith('zh') ? 'privacy-zh.html' : 'privacy-en.html'
}

export function buildPrivacyPolicyUrl(resourcesPath: string, language: string, theme: ThemeMode): string {
  const filePath = joinPath(resourcesPath, `cherry-studio/${getPrivacyPolicyAsset(language)}`) as FilePath
  const themeName = theme === ThemeMode.dark ? 'dark' : 'light'
  return `${toFileUrl(filePath)}?theme=${themeName}`
}

interface PrivacyPolicyDialogProps {
  open: boolean
  onAccept: () => void | Promise<void>
  onDecline?: () => void | Promise<void>
  acceptButtonText?: string
  isPending?: boolean
}

export function PrivacyPolicyDialog({
  open,
  onAccept,
  onDecline,
  acceptButtonText,
  isPending = false
}: PrivacyPolicyDialogProps) {
  const { t, i18n } = useTranslation()
  const { theme } = useTheme()
  const [privacyUrl, setPrivacyUrl] = useState('')
  const [loadFailed, setLoadFailed] = useState(false)
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'en-US'

  useEffect(() => {
    if (!open) return

    let cancelled = false
    setPrivacyUrl('')
    setLoadFailed(false)

    void ipcApi
      .request('app.get_info')
      .then(({ resourcesPath }) => {
        if (!cancelled) {
          setPrivacyUrl(buildPrivacyPolicyUrl(resourcesPath, language, theme))
        }
      })
      .catch((error) => {
        logger.error('Failed to load privacy policy resource', error as Error)
        if (!cancelled) {
          setLoadFailed(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [language, open, theme])

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        closeOnOverlayClick={false}
        className="flex h-[min(85vh,760px)] max-h-[calc(100vh-2rem)] w-[min(900px,calc(100vw-2rem))] max-w-none flex-col gap-4 overflow-hidden p-5 sm:max-w-none"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}>
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('privacy_policy.title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('privacy_policy.title')}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-background">
          {privacyUrl ? (
            <iframe
              src={privacyUrl}
              title={t('privacy_policy.title')}
              sandbox="allow-scripts"
              className="block h-full w-full border-0 bg-transparent"
            />
          ) : (
            <div className="flex items-center gap-2 text-foreground-secondary text-sm">
              {!loadFailed && <LoaderCircle className="size-4 animate-spin" />}
              <span>{loadFailed ? t('privacy_policy.load_failed') : t('common.loading')}</span>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0">
          {onDecline && (
            <Button type="button" variant="outline" disabled={isPending} onClick={() => void onDecline()}>
              {t('common.decline')}
            </Button>
          )}
          <Button type="button" loading={isPending} onClick={() => void onAccept()}>
            {acceptButtonText ?? t('common.i_know')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
