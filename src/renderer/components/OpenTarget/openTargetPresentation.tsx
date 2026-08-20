import { Badge } from '@cherrystudio/ui'
import type { CommandContextMenuExtraItem } from '@renderer/components/command'
import {
  type ExternalOpenTargetPathKind,
  externalOpenTargetService
} from '@renderer/services/externalOpenTargetService'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { isMac, isWin } from '@renderer/utils/platform'
import type { ExternalOpenTarget } from '@shared/types/externalApp'
import type { TFunction } from 'i18next'

import { OpenTargetIcon } from './OpenTargetIcon'

export function getOpenTargetLabel(target: ExternalOpenTarget, t: TFunction): string {
  if (target.kind === 'file_manager') {
    if (isMac) return t('agent.session.file_manager.finder')
    if (isWin) return t('agent.session.file_manager.file_explorer')
    return t('agent.session.file_manager.files')
  }
  return target.name ?? t('agent.preview_pane.default_app')
}

export function getOpenTargetBadge(target: ExternalOpenTarget, t: TFunction) {
  if (target.kind !== 'system_default' || !target.name) return undefined
  return (
    <Badge variant="secondary" className="px-1.5 py-0 font-normal text-[10px]">
      {t('agent.preview_pane.default_app')}
    </Badge>
  )
}

export async function loadOpenTargetMenuItems({
  targetPath,
  pathKind,
  t
}: {
  targetPath: string
  pathKind: ExternalOpenTargetPathKind
  t: TFunction
}): Promise<readonly CommandContextMenuExtraItem[]> {
  try {
    const result = await externalOpenTargetService.list(targetPath, pathKind)
    return result.targets.map((target) => ({
      type: 'item',
      id: `external-open-target.${target.id}`,
      label: getOpenTargetLabel(target, t),
      icon: <OpenTargetIcon target={target} />,
      badge: getOpenTargetBadge(target, t),
      onSelect: () => {
        void externalOpenTargetService.open(targetPath, result.pathKind, target.id).catch((error) => {
          toast.error(formatErrorMessageWithPrefix(error, t('files.error.open_path', { path: targetPath })))
        })
      }
    }))
  } catch (error) {
    toast.error(formatErrorMessageWithPrefix(error, t('files.error.open_path', { path: targetPath })))
    return []
  }
}
