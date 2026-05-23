import { Button } from '@cherrystudio/ui'
import { CORE_DEP_NAMES } from '@shared/data/presets/mise-tools'
import { useNavigate } from '@tanstack/react-router'
import { TriangleAlert } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface MiseState {
  updatedAt: string
  tools: Record<string, { name: string; tool: string; version: string; installedAt: string }>
}

const EnvironmentDependenciesIndicator: FC = () => {
  const [miseState, setMiseState] = useState<MiseState | null>(null)
  const { t } = useTranslation()
  const navigate = useNavigate()

  const refreshState = useCallback(async () => {
    try {
      setMiseState(await window.api.mise.getState())
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    void refreshState()
    return window.api.mise.onStateChanged((state) => setMiseState(state))
  }, [refreshState])

  if (!miseState) return null
  const coreDepsInstalled = Array.from(CORE_DEP_NAMES).every((name) => Boolean(miseState.tools[name]))
  if (coreDepsInstalled) return null

  return (
    <Button
      className="nodrag h-8 rounded-lg px-2 text-destructive shadow-none hover:text-destructive"
      variant="ghost"
      aria-label={t('settings.plugins.coreDepsMissing')}
      title={t('settings.plugins.coreDepsMissing')}
      onClick={() => navigate({ to: '/settings/plugins' })}>
      <TriangleAlert size={14} />
    </Button>
  )
}

export default EnvironmentDependenciesIndicator
