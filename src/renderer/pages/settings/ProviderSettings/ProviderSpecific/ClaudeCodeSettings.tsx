import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { CodeCli } from '@shared/types/codeCli'
import { CheckCircle2, CircleAlert, Copy, RefreshCw, TerminalSquare } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ProviderHelpLink } from '../primitives/ProviderSettingsPrimitives'

const LEGAL_AND_COMPLIANCE_URL = 'https://code.claude.com/docs/en/legal-and-compliance'

const logger = loggerService.withContext('ClaudeCodeSettings')

const LOGIN_COMMAND = 'claude /login'

interface ClaudeCodeSettingsProps {
  providerId: string
}

const ClaudeCodeSettings: FC<ClaudeCodeSettingsProps> = ({ providerId }) => {
  const { t } = useTranslation()
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)
  const [launching, setLaunching] = useState(false)

  const checkLogin = useCallback(async () => {
    setChecking(true)
    try {
      setLoggedIn(await ipcApi.request('oauth.check_external_login', { providerId }))
    } catch (error) {
      logger.error('Failed to check Claude login status', error as Error)
      setLoggedIn(false)
    } finally {
      setChecking(false)
    }
  }, [providerId])

  useEffect(() => {
    void checkLogin()
  }, [checkLogin])

  const handleOpenTerminal = useCallback(async () => {
    setLaunching(true)
    try {
      const { homePath } = await window.api.getAppInfo()
      const result = await window.api.codeCli.run(CodeCli.CLAUDE_CODE, '', homePath, {})
      if (!result.success) {
        logger.error('Failed to launch Claude login terminal', { message: result.message })
        window.toast.error(t('settings.provider.claude_code.launch_failed'))
      }
    } catch (error) {
      logger.error('Failed to launch Claude login terminal', error as Error)
      window.toast.error(t('settings.provider.claude_code.launch_failed'))
    } finally {
      setLaunching(false)
    }
  }, [t])

  const handleCopyCommand = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(LOGIN_COMMAND)
      window.toast.success(t('common.copied'))
    } catch (error) {
      logger.error('Failed to copy login command', error as Error)
      window.toast.error(t('common.copy_failed'))
    }
  }, [t])

  // Until the first probe resolves, loggedIn is null — show a loading row rather
  // than the sign-in panel, so an already-signed-in user doesn't see it flash.
  if (loggedIn === null) {
    return (
      <div className="flex items-center gap-2 text-foreground-muted text-xs">
        <RefreshCw className="size-4 animate-spin" aria-hidden />
        {t('common.loading')}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {loggedIn ? (
        <div className="flex items-center gap-3 rounded-lg border border-success/30 bg-success/10 p-3">
          <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-foreground text-sm">{t('settings.provider.claude_code.logged_in')}</div>
            <div className="mt-1 text-foreground-muted text-xs">
              {t('settings.provider.claude_code.logged_in_detail')}
            </div>
          </div>
          <Button variant="secondary" size="sm" disabled={checking} onClick={() => void checkLogin()}>
            <RefreshCw className="size-4" />
            {t('settings.provider.claude_code.recheck')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-info/40 bg-info/10 p-3">
          <div className="flex gap-3">
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-info" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-foreground text-sm">
                {t('settings.provider.claude_code.description')}
              </div>
              <div className="mt-1 text-foreground-muted text-xs">
                {t('settings.provider.claude_code.description_detail')}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={launching} onClick={() => void handleOpenTerminal()}>
              <TerminalSquare className="size-4" />
              {t('settings.provider.claude_code.open_terminal')}
            </Button>
            <Button variant="secondary" onClick={() => void handleCopyCommand()}>
              <Copy className="size-4" />
              <code className="font-mono">{LOGIN_COMMAND}</code>
            </Button>
            <Button variant="secondary" disabled={checking} onClick={() => void checkLogin()}>
              <RefreshCw className="size-4" />
              {t('settings.provider.claude_code.recheck')}
            </Button>
          </div>
        </div>
      )}
      <div className="text-foreground-muted text-xs">
        {t('settings.provider.claude_code.agent_only_note')}{' '}
        <ProviderHelpLink className="mx-0" href={LEGAL_AND_COMPLIANCE_URL} target="_blank" rel="noreferrer">
          {t('settings.provider.claude_code.legal_link')}
        </ProviderHelpLink>
      </div>
    </div>
  )
}

export default ClaudeCodeSettings
