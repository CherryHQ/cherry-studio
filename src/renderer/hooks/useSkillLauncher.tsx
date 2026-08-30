import { ConfirmDialog } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import type { InstalledSkill } from '@shared/data/types/agent'
import { createContext, type PropsWithChildren, use, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('SkillLauncher')

type LaunchSkill = (skill: InstalledSkill) => Promise<void>

const SkillLauncherContext = createContext<LaunchSkill | null>(null)

export function SkillLauncherProvider({ children }: PropsWithChildren) {
  const { t } = useTranslation()
  const { trigger: enableSkill } = useMutation('PATCH', '/skills/:skillId', {
    refresh: ['/skills', '/skills/*']
  })
  const [pendingSkill, setPendingSkill] = useState<InstalledSkill | null>(null)
  const [isLaunching, setIsLaunching] = useState(false)

  const createSessionAndOpen = useCallback(async (skill: InstalledSkill) => {
    setIsLaunching(true)
    try {
      const { sessionId } = await ipcApi.request('ai.agent.skill_session.create', { skillId: skill.id })
      openRoute('/app/agents', { intent: 'skill', sessionId, skillId: skill.id })
    } finally {
      setIsLaunching(false)
    }
  }, [])

  const launchSkill = useCallback<LaunchSkill>(
    async (skill) => {
      if (!skill.isGlobalEnabled) {
        setPendingSkill(skill)
        return
      }
      try {
        await createSessionAndOpen(skill)
      } catch (error) {
        logger.error('Failed to launch Skill in Cherry Assistant', error as Error, { skillId: skill.id })
        toast.error(t('settings.skills.launchFailed', { name: skill.name }))
      }
    },
    [createSessionAndOpen, t]
  )

  const confirmLaunch = useCallback(async () => {
    const skill = pendingSkill
    if (!skill) return

    setIsLaunching(true)
    try {
      const enabledSkill = await enableSkill({ params: { skillId: skill.id }, body: { isGlobalEnabled: true } })
      setPendingSkill(null)
      await createSessionAndOpen(enabledSkill)
    } catch (error) {
      logger.error('Failed to enable and launch Skill', error as Error, { skillId: skill.id })
      toast.error(t('settings.skills.launchFailed', { name: skill.name }))
    } finally {
      setIsLaunching(false)
    }
  }, [createSessionAndOpen, enableSkill, pendingSkill, t])

  const value = useMemo(() => launchSkill, [launchSkill])

  return (
    <SkillLauncherContext value={value}>
      {children}
      <ConfirmDialog
        open={Boolean(pendingSkill)}
        onOpenChange={(open) => {
          if (!open && !isLaunching) setPendingSkill(null)
        }}
        title={t('settings.skills.enableToTry.title')}
        description={t('settings.skills.enableToTry.description', { name: pendingSkill?.name ?? '' })}
        confirmText={t('settings.skills.enableToTry.confirm')}
        cancelText={t('common.cancel')}
        confirmLoading={isLaunching}
        onConfirm={confirmLaunch}
      />
    </SkillLauncherContext>
  )
}

export function useSkillLauncher(): LaunchSkill {
  const launchSkill = use(SkillLauncherContext)
  if (!launchSkill) throw new Error('useSkillLauncher must be used within SkillLauncherProvider')
  return launchSkill
}
