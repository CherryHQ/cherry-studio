import store from '@renderer/store'
import { updateTopicGroups } from '@renderer/store/assistants'

import { safeFilter, safeMap } from './safeArrayUtils'

/**
 * 将现有话题分组迁移为与助手关联的模式
 * 对于没有assistantId的话题分组，将其分配给默认助手
 */
export function migrateTopicGroups() {
  const state = store.getState()
  const { assistants, topicGroups, defaultAssistant } = state.assistants

  // 安全检查：确保topicGroups存在
  if (!topicGroups) {
    console.log('话题分组不存在，无需迁移')
    return
  }

  // 检查是否有需要迁移的分组（没有assistantId的分组）
  const needsMigration = safeFilter(topicGroups, (group) => !!group && !group.assistantId).length > 0

  if (needsMigration && topicGroups.length > 0) {
    console.log('正在迁移话题分组...')

    // 找到默认助手ID
    const defaultAssistantId =
      defaultAssistant?.id || (Array.isArray(assistants) && assistants.length > 0 ? assistants[0]?.id : undefined)

    if (!defaultAssistantId) {
      console.error('无法迁移话题分组：找不到默认助手')
      return
    }

    // 为每个没有助手ID的分组添加默认助手ID
    const updatedGroups = safeMap(topicGroups, (group) => {
      if (group && !group.assistantId) {
        console.log(`将分组 "${group.name}" 分配给默认助手`)
        return { ...group, assistantId: defaultAssistantId }
      }
      return group
    })

    // 更新Redux状态
    store.dispatch(updateTopicGroups(updatedGroups))
    console.log('话题分组迁移完成')
  }
}
