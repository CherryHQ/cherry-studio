import { createActionRegistry } from '@renderer/components/chat/actions/actionRegistry'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import type { ResourceListGroup } from '@renderer/components/chat/resources'
import { FinderIcon } from '@renderer/components/Icons/SvgIcon'
import { isMac, isWin } from '@renderer/config/constant'
import type { TFunction } from 'i18next'
import { FolderOpen, SquarePen, Trash2 } from 'lucide-react'

export interface WorkdirGroupActionContext {
  canDelete: boolean
  canRename: boolean
  deleteDisabled?: boolean
  group: ResourceListGroup
  onDelete: (group: ResourceListGroup) => void | Promise<void>
  onOpen: (workdirPath: string) => void | Promise<void>
  onRename: (group: ResourceListGroup) => void | Promise<void>
  renameDisabled?: boolean
  t: TFunction
  workdirPath: string
}

export type WorkdirGroupAction = ResolvedAction<WorkdirGroupActionContext>

const workdirGroupActionRegistry = createActionRegistry<WorkdirGroupActionContext>()

function getFileManagerName(t: TFunction) {
  return isMac
    ? t('agent.session.file_manager.finder')
    : isWin
      ? t('agent.session.file_manager.file_explorer')
      : t('agent.session.file_manager.files')
}

workdirGroupActionRegistry.registerCommand({
  id: 'workdir-group.open',
  run: ({ onOpen, workdirPath }) => onOpen(workdirPath)
})

workdirGroupActionRegistry.registerCommand({
  id: 'workdir-group.rename',
  availability: ({ canRename, renameDisabled }) => ({ visible: canRename, enabled: !renameDisabled }),
  run: ({ group, onRename }) => onRename(group)
})

workdirGroupActionRegistry.registerCommand({
  id: 'workdir-group.delete',
  availability: ({ canDelete, deleteDisabled }) => ({ visible: canDelete, enabled: !deleteDisabled }),
  run: ({ group, onDelete }) => onDelete(group)
})

workdirGroupActionRegistry.registerAction({
  id: 'workdir-group.open',
  commandId: 'workdir-group.open',
  label: ({ t }) => t('common.open_in', { name: getFileManagerName(t) }),
  icon: () => (isMac ? <FinderIcon className="size-3.5" /> : <FolderOpen size={14} />),
  order: 10,
  surface: 'menu'
})

workdirGroupActionRegistry.registerAction({
  id: 'workdir-group.rename',
  commandId: 'workdir-group.rename',
  label: ({ t }) => t('agent.session.workdir.rename.trigger'),
  icon: () => <SquarePen size={14} />,
  order: 20,
  surface: 'menu'
})

workdirGroupActionRegistry.registerAction({
  id: 'workdir-group.delete',
  commandId: 'workdir-group.delete',
  label: ({ t }) => t('agent.session.workdir.delete.trigger'),
  icon: () => <Trash2 size={14} className="lucide-custom text-destructive" />,
  group: 'danger',
  order: 30,
  surface: 'menu',
  danger: true
})

export function resolveWorkdirGroupActions(context: WorkdirGroupActionContext): WorkdirGroupAction[] {
  return workdirGroupActionRegistry.resolve(context, 'menu')
}

export async function executeWorkdirGroupAction(
  action: WorkdirGroupAction,
  context: WorkdirGroupActionContext
): Promise<boolean> {
  return workdirGroupActionRegistry.execute(action.id, context)
}
