import type { TFunction } from 'i18next'
import { AppWindow } from 'lucide-react'

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
    <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">
      {t('agent.preview_pane.default_app')}
    </Badge>
  )
}

/**
 * The shared "open" section of a file or folder menu: the default app and the file manager at the
 * top level, every other target under "Open with".
 */
export function buildOpenTargetMenuItems({
  targets,
  onOpen,
  t
}: {
  targets: readonly ExternalOpenTarget[]
  onOpen: (target: ExternalOpenTarget) => void
  t: TFunction
}): CommandContextMenuExtraItem[] {
  const defaultApp = targets.find((target) => target.kind === 'system_default')
  const fileManager = targets.find((target) => target.kind === 'file_manager')
  const others = targets.filter((target) => target !== defaultApp && target !== fileManager)
  const item = (target: ExternalOpenTarget, label: string): CommandContextMenuExtraItem => ({
    type: 'item',
    id: `external-open-target.${target.id}`,
    label,
    icon: <OpenTargetIcon target={target} />,
    onSelect: () => onOpen(target)
  })
  const revealLabel = t(
    isMac
      ? 'chat.input.tools.reveal_in_finder'
      : isWin
        ? 'chat.input.tools.reveal_in_file_explorer'
        : 'chat.input.tools.reveal_in_file_manager'
  )
  return [
    ...(defaultApp ? [item(defaultApp, t('common.open_in', { name: getOpenTargetLabel(defaultApp, t) }))] : []),
    ...(fileManager ? [item(fileManager, revealLabel)] : []),
    ...(others.length
      ? [
          {
            type: 'submenu' as const,
            id: 'external-open-target.open-with',
            label: t('chat.input.tools.open_with'),
            icon: <AppWindow size={14} />,
            children: others.map((target) => item(target, getOpenTargetLabel(target, t)))
          }
        ]
      : [])
  ]
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
    return buildOpenTargetMenuItems({
      targets: result.targets,
      onOpen: (target) => {
        void externalOpenTargetService.open(targetPath, result.pathKind, target.id).catch((error) => {
          toast.error(formatErrorMessageWithPrefix(error, t('files.error.open_path', { path: targetPath })))
        })
      },
      t
    })
  } catch (error) {
    toast.error(formatErrorMessageWithPrefix(error, t('files.error.open_path', { path: targetPath })))
    return []
  }
}
