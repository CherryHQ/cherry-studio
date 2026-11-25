import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { useAgent } from '@renderer/hooks/agent/useAgent'
import { useLocalAgentVersion } from '@renderer/hooks/agent/useLocalAgentVersion'
import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { formatErrorMessage } from '@renderer/utils/error'

const installErrorKeys = {
  registry: 'local_agents.install_error.registry',
  unsupported: 'local_agents.install_error.unsupported',
  missing_runtime: 'local_agents.install_error.missing_runtime',
  managed_runtime: 'local_agents.install_error.managed_runtime',
  failed: 'local_agents.install_error.failed',
  not_detected: 'local_agents.install_error.not_detected',
  stopping: 'local_agents.install_error.stopping'
} as const

const logger = loggerService.withContext('AgentErrorUpgrade')

export function AgentErrorUpgrade({ agentId }: { agentId: string }) {
  const { t } = useTranslation()
  const { agent } = useAgent(agentId)
  const config = agent?.configuration?.localRuntime
  const presetId = config?.presetId === 'codex' && config.enabled && !config.executableOverride ? 'codex' : undefined
  const [path, setPath] = useState<string>()
  const [upgrading, setUpgrading] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string }>()
  const pending = useRef(false)
  const version = useLocalAgentVersion(presetId, path)

  useEffect(() => {
    if (!presetId) return
    let active = true
    void ipcApi.request('ai.local_agents.detect', {}).then(
      (detections) => {
        if (active) setPath(detections.find((entry) => entry.presetId === presetId)?.path)
      },
      (error) => logger.debug('Agent detection unavailable', { error })
    )
    return () => {
      active = false
    }
  }, [presetId])

  const upgrade = async () => {
    if (!presetId || !version?.canUpgrade || !version.latest || pending.current) return
    pending.current = true
    setUpgrading(true)
    setResult(undefined)
    try {
      const response = await ipcApi.request('ai.local_agents.install', { presetId, targetVersion: version.latest })
      setResult({
        ok: response.ok,
        message: response.ok
          ? t('code.upgrade_success')
          : [t(installErrorKeys[response.reason], { manager: response.manager ?? '' }), response.detail]
              .filter(Boolean)
              .join('\n')
      })
    } catch (error) {
      setResult({ ok: false, message: formatErrorMessage(error) })
    } finally {
      pending.current = false
      setUpgrading(false)
    }
  }

  if (!presetId) return null
  return (
    <>
      {(upgrading || (version?.canUpgrade && version.latest && !result?.ok)) && (
        <Button
          size="sm"
          variant="outline"
          disabled={upgrading}
          aria-busy={upgrading}
          onClick={(event) => {
            event.stopPropagation()
            void upgrade()
          }}>
          {upgrading && <Loader2 className="size-3.5 animate-spin" />}
          Codex CLI · {t(upgrading ? 'code.upgrading_to' : 'code.upgrade_to', { version: version?.latest })}
        </Button>
      )}
      {result && (
        <span role={result.ok ? 'status' : 'alert'} className="whitespace-pre-wrap text-xs">
          {result.message}
        </span>
      )}
    </>
  )
}
