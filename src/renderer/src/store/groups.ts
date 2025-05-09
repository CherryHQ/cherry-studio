import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface Group {
  id: string
  name: string
  members: string[] // 存放助手ID数组
}

export interface GroupsState {
  groups: Group[]
}

const initialState: GroupsState = {
  groups: [
    {
      id: 'default',
      name: '未分组',
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
      if (action.payload.id === 'default') return
      state.groups.push(action.payload)
    },

    // 删除分组
    removeGroup: (state, action: PayloadAction<{ id: string }>) => {
      // 不允许删除default分组
      if (action.payload.id === 'default') return
      state.groups = state.groups.filter((group) => group.id !== action.payload.id)
    },

    // 更新分组
    updateGroup: (state, action: PayloadAction<Group>) => {
      // 不允许更新default分组
      if (action.payload.id === 'default') return
      state.groups = state.groups.map((group) => (group.id === action.payload.id ? action.payload : group))
    },

    // 添加成员到分组
    addMemberToGroup: (state, action: PayloadAction<{ groupId: string; memberId: string }>) => {
      const { groupId, memberId } = action.payload
      const group = state.groups.find((g) => g.id === groupId)
      if (!group || groupId === 'default') return

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
      if (groupId === 'default') return

      const group = state.groups.find((g) => g.id === groupId)
      if (group) {
        group.members = group.members.filter((id) => id !== memberId)

        // 添加到default组
        const defaultGroup = state.groups.find((g) => g.id === 'default')
        if (defaultGroup && !defaultGroup.members.includes(memberId)) {
          defaultGroup.members.push(memberId)
        }
      }
    },

    // 批量更新分组
    updateGroups: (state, action: PayloadAction<Group[]>) => {
      // 保留default分组
      const defaultGroup = state.groups.find((g) => g.id === 'default')
      state.groups = action.payload
      if (defaultGroup) {
        // 确保default分组存在
        if (!state.groups.some((g) => g.id === 'default')) {
          state.groups.push(defaultGroup)
        }
      }
    }
  }
})

export const { addGroup, removeGroup, updateGroup, addMemberToGroup, removeMemberFromGroup, updateGroups } =
  groupsSlice.actions

export default groupsSlice.reducer
