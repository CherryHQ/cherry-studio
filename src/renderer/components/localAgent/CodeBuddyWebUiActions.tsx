import { ExternalLink, Loader2, Play, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { useSharedCacheValue } from '@data/hooks/useCache'
import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import { cliTabIcon } from '@renderer/utils/tabIcons'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'

const logger = loggerService.withContext('CodeBuddyWebUiActions')

export function CodeBuddyWebUiActions({ config, disabled }: { config: LocalAgentConfiguration; disabled: boolean }) {
  const { t } = useTranslation()
  const { openSmartMiniApp } = useMiniAppPopup()
  const status = useSharedCacheValue('feature.codebuddy.web_ui.status')
  const [pending, setPending] = useState(false)
  useEffect(() => {
    void ipcApi.request('ai.codebuddy_web.status').catch((error) => {
      logger.warn('Failed to read CodeBuddy WebUI status', error as Error)
    })
  }, [])
  const open = (url: string) => {
    const target = new URL(url)
    target.searchParams.set('cherry_navigation_revision', String(Date.now()))
    openSmartMiniApp({
      appId: 'codebuddy-web',
      name: 'CodeBuddy Code',
      url: target.toString(),
      logo: cliTabIcon('codebuddy-code')
    })
  }
  const run = async (stop: boolean) => {
    if (pending) return
    setPending(true)
    try {
      if (stop) await ipcApi.request('ai.codebuddy_web.stop')
      else {
        const result = await ipcApi.request('ai.codebuddy_web.start', config)
        if (result.url) open(result.url)
      }
    } catch {
      toast.error(t('code.launch.error'))
    } finally {
      setPending(false)
    }
  }
  const running = status?.status === 'running'
  const working = pending || status?.status === 'starting'
  return (
    <>
      {(!running || status.owned) && (
        <Button
          variant="outline"
          size="sm"
          className="h-8 rounded-lg border-border-subtle text-xs shadow-none"
          disabled={disabled || working}
          onClick={() => void run(running)}>
          {working ? (
            <Loader2 className="lucide-custom size-3.5 animate-spin text-muted-foreground" />
          ) : running ? (
            <Square className="lucide-custom size-3.5 text-muted-foreground" />
          ) : (
            <Play className="lucide-custom size-3.5 text-muted-foreground" />
          )}
          {t(running ? 'code.stop' : 'code.launch.label')}
        </Button>
      )}
      {running && (
        <Button
          variant="outline"
          size="sm"
          className="h-8 rounded-lg border-border-subtle text-xs shadow-none"
          disabled={disabled || working}
          onClick={() => void run(false)}>
          <ExternalLink className="lucide-custom size-3.5 text-muted-foreground" />
          {t('code.open_web_ui')}
        </Button>
      )}
    </>
  )
}
