import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import i18n from '@renderer/i18n'

export const defaultGroupId = 'defaultGroupId'
export const defaultGroupName = i18n.t('assistants.group.defaultName')

export interface Group {
  id: string
  name: string
  members: string[] // 存放助手ID数组
}

export interface GroupsState {
  expandGroupIds: string[]
  groups: Group[]
}

const initialState: GroupsState = {
  expandGroupIds: [],
  groups: [
    {
      id: defaultGroupId,
      name: defaultGroupName,
      members: [] // 初始为空，运行时自动填充未分组的助手
    }
  ]
}

const groupsSlice = createSlice({
  name: 'groups',
  initialState,
  reducers: {
    // 添加分组
    addGroup: (state, action: PayloadAction<Group>) => {
      // 不允许添加id为default的分组
      if (action.payload.id === defaultGroupId) return
      state.groups.push(action.payload)
    },

    // 删除分组
    removeGroup: (state, action: PayloadAction<{ id: string }>) => {
      // 不允许删除default分组
      if (action.payload.id === defaultGroupId) return
      state.groups = state.groups.filter((group) => group.id !== action.payload.id)
    },

    // 更新分组
    updateGroup: (state, action: PayloadAction<Group>) => {
      // 不允许更新default分组
      if (action.payload.id === defaultGroupId) return
      state.groups = state.groups.map((group) => (group.id === action.payload.id ? action.payload : group))
    },

    // 添加成员到分组
    addMemberToGroup: (state, action: PayloadAction<{ groupId: string; memberId: string }>) => {
      const { groupId, memberId } = action.payload
      const group = state.groups.find((g) => g.id === groupId)
      if (!group || groupId === defaultGroupId) return

      // 如果成员不在该组中，则添加
      if (!group.members.includes(memberId)) {
        group.members.push(memberId)

        // 从其他组中移除该成员（包括default组）
        state.groups.forEach((g) => {
          if (g.id !== groupId) {
            g.members = g.members.filter((id) => id !== memberId)
          }
        })
      }
    },

    // 从分组移除成员
    removeMemberFromGroup: (state, action: PayloadAction<{ groupId: string; memberId: string }>) => {
      const { groupId, memberId } = action.payload
      if (groupId === defaultGroupId) return

      const group = state.groups.find((g) => g.id === groupId)
      if (group) {
        group.members = group.members.filter((id) => id !== memberId)

        // 添加到default组
        const defaultGroup = state.groups.find((g) => g.id === defaultGroupId)
        if (defaultGroup && !defaultGroup.members.includes(memberId)) {
          defaultGroup.members.push(memberId)
        }
      }
    },

    // 批量更新分组
    updateGroups: (state, action: PayloadAction<Group[]>) => {
      // 保留default分组
      const defaultGroup = state.groups.find((g) => g.id === defaultGroupId)
      state.groups = action.payload
      if (defaultGroup) {
        // 确保default分组存在
        if (!state.groups.some((g) => g.id === defaultGroupId)) {
          state.groups.push(defaultGroup)
        }
      }
    },

    // 初始化分组和助手同步
    initializeGroups: (state, action: PayloadAction<{ assistantIds: string[] }>) => {
      const { assistantIds } = action.payload
      const assistantIdSet = new Set(assistantIds)
      const defaultGroup = state.groups.find((g) => g.id === defaultGroupId)!

      // 第一步：检查所有分组中的成员是否都在助手中
      state.groups.forEach((group) => {
        group.members = group.members.filter((id) => {
          const exists = assistantIdSet.has(id)
          // 如果成员不存在于助手中且不是默认分组，则移除
          if (!exists && group.id !== defaultGroupId) {
            return false
          }
          return exists
        })
      })

      // 第二步：检查所有助手是否都在某个分组中
      const allGroupMembers = new Set<string>()
      state.groups.forEach((group) => {
        group.members.forEach((id) => allGroupMembers.add(id))
      })

      // 找出不在任何分组中的助手
      const missingAssistants = assistantIds.filter((id) => !allGroupMembers.has(id))

      // 将这些助手添加到默认分组
      missingAssistants.forEach((id) => {
        if (!defaultGroup.members.includes(id)) {
          defaultGroup.members.push(id)
        }
      })
    },
    setExpandGroupIds: (state, action: PayloadAction<string[]>) => {
      state.expandGroupIds = action.payload
    }
  }
})

export const {
  addGroup,
  removeGroup,
  updateGroup,
  addMemberToGroup,
  removeMemberFromGroup,
  updateGroups,
  initializeGroups,
  setExpandGroupIds
} = groupsSlice.actions

export default groupsSlice.reducer
