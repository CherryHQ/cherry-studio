import { ToolCase } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import { useComposerToolDispatch } from '@renderer/components/composer/ComposerToolRuntime'
import type { ComposerUnifiedPanelControl } from '@renderer/components/composer/quickPanel'
import { PermissionModeLauncherRuntime } from '@renderer/components/composer/tools/definitions/permissionModeTool'
import { PERMISSION_MODE_TOOLBAR_MANIFEST } from '@renderer/components/composer/tools/toolbarManifests'
import type { ToolRenderContext } from '@renderer/components/composer/tools/types'
import { agentSkillToComposerToken } from '@renderer/components/composer/variants/agentComposerTokens'
import { COMPOSER_SEND_ACCESSORY_BUTTON_CLASS } from '@renderer/components/composer/variants/shared/ComposerControlScaffolding'
import {
  AGENT_SKILLS_LAUNCHER_ID,
  useComposerSkillsLauncher
} from '@renderer/components/composer/variants/shared/useComposerSkillsLauncher'
import { PermissionModeIcon } from '@renderer/components/PermissionModeOption'
import type { QuickPanelInputAdapter } from '@renderer/components/QuickPanel'
import { useSession } from '@renderer/hooks/agent/useSession'
import { useAvailableSkills } from '@renderer/hooks/useSkills'
import type { PermissionMode } from '@renderer/types/agent'
import { permissionModeCards } from '@renderer/utils/agent'
import type { SideChatTurnSettings } from '@shared/data/types/sideChat'
import type { LocalSkill } from '@shared/types/skill'

const SIDE_CHAT_PERMISSION_CARDS = permissionModeCards.filter(
  (card) => card.mode === 'default' || card.mode === 'bypassPermissions'
)

type Props = {
  sourceTopicId: string
  agentId?: string
  permissionMode: SideChatTurnSettings['permissionMode']
  onPermissionModeChange: (mode: SideChatTurnSettings['permissionMode']) => void
  unifiedPanelControl?: ComposerUnifiedPanelControl
  disabled: boolean
}

export function SideChatToolControls({
  sourceTopicId,
  agentId,
  permissionMode,
  onPermissionModeChange,
  unifiedPanelControl,
  disabled
}: Props) {
  const { t } = useTranslation()
  const { toolsRegistry } = useComposerToolDispatch()
  const permissionLauncher = useMemo<ToolRenderContext<readonly [], readonly []>['launcher']>(
    () => ({
      registerLaunchers: (entries, footerActions) =>
        toolsRegistry.registerLaunchers('permission_mode', entries, footerActions)
    }),
    [toolsRegistry]
  )
  const applyPermissionMode = useCallback(
    (mode: PermissionMode) => {
      if (mode === 'default' || mode === 'bypassPermissions') onPermissionModeChange(mode)
    },
    [onPermissionModeChange]
  )
  const { session } = useSession(agentId ? sourceTopicId.slice('agent-session:'.length) : null)
  const { skills, refresh, loading, error } = useAvailableSkills(agentId, session?.workspace?.path, {
    enabled: !agentId || !!session,
    includeGlobal: !agentId
  })
  const insertSkill = useCallback((skill: LocalSkill, inputAdapter?: QuickPanelInputAdapter) => {
    inputAdapter?.insertToken?.(agentSkillToComposerToken(skill))
    inputAdapter?.focus()
  }, [])
  useComposerSkillsLauncher({ skills, refresh, onInsertSkill: insertSkill, disabled })
  const modeCard = SIDE_CHAT_PERMISSION_CARDS.find((card) => card.mode === permissionMode)!
  const skillLabel = t('plugins.skills')
  const permissionLabel = t('agent.settings.permissionMode.title')
  const permissionTooltip = `${permissionLabel} · ${t(modeCard.titleKey, modeCard.titleFallback)}`

  return (
    <>
      <Tooltip content={error ? t('side_chat.load_error') : skillLabel}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={COMPOSER_SEND_ACCESSORY_BUTTON_CLASS}
          disabled={disabled || loading || !unifiedPanelControl?.available}
          aria-label={skillLabel}
          aria-haspopup="menu"
          onClick={() => unifiedPanelControl?.open({ launcherId: AGENT_SKILLS_LAUNCHER_ID, searchText: skillLabel })}>
          <ToolCase size={18} />
        </Button>
      </Tooltip>
      <Tooltip content={permissionTooltip}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={COMPOSER_SEND_ACCESSORY_BUTTON_CLASS}
          disabled={disabled || !unifiedPanelControl?.available}
          aria-label={permissionTooltip}
          aria-haspopup="menu"
          onClick={() =>
            unifiedPanelControl?.open({
              launcherId: PERMISSION_MODE_TOOLBAR_MANIFEST.toolbar.id,
              searchText: permissionLabel
            })
          }>
          <PermissionModeIcon mode={permissionMode} />
        </Button>
      </Tooltip>
      <PermissionModeLauncherRuntime
        launcher={permissionLauncher}
        permissionModeCards={SIDE_CHAT_PERMISSION_CARDS}
        currentMode={permissionMode}
        applyMode={applyPermissionMode}
        disabled={disabled}
        t={t}
      />
    </>
  )
}
