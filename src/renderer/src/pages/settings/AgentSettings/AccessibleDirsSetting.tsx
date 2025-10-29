import { Button, Tooltip } from '@heroui/react'
import { loggerService } from '@logger'
import { AgentBaseWithId, UpdateAgentBaseForm, UpdateAgentFunctionUnion } from '@renderer/types'
import { Plus } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsItem, SettingsTitle } from './shared'

export interface AccessibleDirsSettingProps {
  base: AgentBaseWithId | undefined | null
  update: UpdateAgentFunctionUnion
}

const logger = loggerService.withContext('AccessibleDirsSetting')

export const AccessibleDirsSetting = ({ base, update }: AccessibleDirsSettingProps) => {
  const { t } = useTranslation()

  const updateAccessiblePaths = useCallback(
    (accessible_paths: UpdateAgentBaseForm['accessible_paths']) => {
      if (!base) return
      update({ id: base.id, accessible_paths })
    },
    [base, update]
  )

  const addAccessiblePath = useCallback(async () => {
    if (!base) return

    try {
      const selected = await window.api.file.selectFolder()
      if (!selected) {
        return
      }

      if (base.accessible_paths.includes(selected)) {
        window.toast.warning(t('agent.session.accessible_paths.duplicate'))
        return
      }

      updateAccessiblePaths([...base.accessible_paths, selected])
    } catch (error) {
      logger.error('Failed to select accessible path:', error as Error)
      window.toast.error(t('agent.session.accessible_paths.select_failed'))
    }
  }, [base, t, updateAccessiblePaths])

  const removeAccessiblePath = useCallback(
    (path: string) => {
      if (!base) return
      const newPaths = base.accessible_paths.filter((p) => p !== path)
      if (newPaths.length === 0) {
        window.toast.error(t('agent.session.accessible_paths.error.at_least_one'))
        return
      }
      updateAccessiblePaths(newPaths)
    },
    [base, t, updateAccessiblePaths]
  )

  if (!base) return null

  return (
    <SettingsItem>
      <SettingsTitle
        actions={
          <Tooltip content={t('agent.session.accessible_paths.add')}>
            <Button variant="light" size="sm" startContent={<Plus />} isIconOnly onPress={addAccessiblePath} />
          </Tooltip>
        }>
        {t('agent.session.accessible_paths.label')}
      </SettingsTitle>
      <ul className="flex flex-col gap-2">
        {base.accessible_paths.map((path) => (
          <li
            key={path}
            className="flex items-center justify-between gap-2 rounded-medium border border-default-200 px-2 py-1">
            <span className="w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm" title={path}>
              {path}
            </span>
            <Button size="sm" variant="light" color="danger" onPress={() => removeAccessiblePath(path)}>
              {t('common.delete')}
            </Button>
          </li>
        ))}
      </ul>
    </SettingsItem>
  )
}
