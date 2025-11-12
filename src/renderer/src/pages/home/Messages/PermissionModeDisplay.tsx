import { permissionModeCards } from '@renderer/config/agent'
import SessionSettingsPopup from '@renderer/pages/settings/AgentSettings/SessionSettingsPopup'
import type { GetAgentSessionResponse, PermissionMode } from '@renderer/types'
import { FileEdit, Lightbulb, Shield, ShieldOff } from 'lucide-react'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  session: GetAgentSessionResponse
  agentId: string
}

const getPermissionModeConfig = (mode: PermissionMode) => {
  switch (mode) {
    case 'default':
      return {
        icon: <Shield size={18} color="var(--color-primary)" />
      }
    case 'plan':
      return {
        icon: <Lightbulb size={18} color="#faad14" />
      }
    case 'acceptEdits':
      return {
        icon: <FileEdit size={18} color="#52c41a" />
      }
    case 'bypassPermissions':
      return {
        icon: <ShieldOff size={18} color="var(--color-error)" />
      }
    default:
      return {
        icon: <Shield size={18} color="var(--color-primary)" />
      }
  }
}

const PermissionModeDisplay: FC<Props> = ({ session, agentId }) => {
  const { t } = useTranslation()

  const permissionMode = session?.configuration?.permission_mode ?? 'default'

  const modeCard = useMemo(() => {
    return permissionModeCards.find((card) => card.mode === permissionMode)
  }, [permissionMode])

  const modeConfig = useMemo(() => getPermissionModeConfig(permissionMode), [permissionMode])

  const handleClick = () => {
    SessionSettingsPopup.show({
      agentId,
      sessionId: session.id,
      tab: 'tooling'
    })
  }

  if (!modeCard) {
    return null
  }

  return (
    <div
      onClick={handleClick}
      className="mx-2 cursor-pointer rounded-lg border-[0.5px] border-[var(--color-border)] px-3 py-2">
      <div className="flex items-center gap-2.5">
        <div className="flex shrink-0 items-center justify-center">{modeConfig.icon}</div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-[var(--color-text-1)] text-xs">
            {t(modeCard.titleKey, modeCard.titleFallback)}
          </div>
          <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-[var(--color-text-2)] leading-[1.4]">
            {t(modeCard.descriptionKey, modeCard.descriptionFallback)}{' '}
            {t(modeCard.behaviorKey, modeCard.behaviorFallback)}
          </div>
        </div>
      </div>
    </div>
  )
}

export default PermissionModeDisplay
