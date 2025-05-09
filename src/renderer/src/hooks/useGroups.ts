import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addGroup,
  addMemberToGroup,
  removeGroup,
  removeMemberFromGroup,
  updateGroup,
  updateGroups
} from '@renderer/store/groups'
import { Group } from '@renderer/types'
import { useCallback } from 'react'

export function useGroups() {
  const { groups } = useAppSelector((state) => state.groups)
  const { assistants } = useAppSelector((state) => state.assistants)
  const dispatch = useAppDispatch()

  // 初始化时检查是否需要自动分组
  if (groups.length === 1 && groups[0].id === 'default' && groups[0].members.length === 0 && assistants.length > 0) {
    const defaultGroup = {
      ...groups[0],
      members: assistants.map((a) => a.id)
    }
    dispatch(updateGroups([defaultGroup]))
  }

  return {
    groups,
    addGroup: useCallback(
      (group: Group) => {
        // 不允许添加id为default的分组
        if (group.id === 'default') return
        dispatch(addGroup(group))
      },
      [dispatch]
    ),
    removeGroup: useCallback(
      (id: string) => {
        // 不允许删除default分组
        if (id === 'default') return
        dispatch(removeGroup({ id }))
      },
      [dispatch]
    ),
    updateGroup: useCallback(
      (group: Group) => {
        // 不允许更新default分组
        if (group.id === 'default') return
        dispatch(updateGroup(group))
      },
      [dispatch]
    ),
    addMemberToGroup: useCallback(
      (groupId: string, memberId: string) => {
        // 不允许直接操作default分组
        if (groupId === 'default') return
        dispatch(addMemberToGroup({ groupId, memberId }))
      },
      [dispatch]
    ),
    removeMemberFromGroup: useCallback(
      (groupId: string, memberId: string) => {
        // 不允许直接操作default分组
        if (groupId === 'default') return
        dispatch(removeMemberFromGroup({ groupId, memberId }))
      },
      [dispatch]
    ),
    updateGroups: useCallback<(groups: Group[], assistants?: string[]) => void>(
      (groups, assistants) => {
        // 确保保留default分组
        const defaultGroup = groups.find((g) => g.id === 'default') || {
          id: 'default',
          name: '未分组',
          members: []
        }

        // 如果只有一个分组且未分组下没有成员，自动将所有助手放入未分组
        if (
          groups.length === 1 &&
          groups[0].id === 'default' &&
          groups[0].members.length === 0 &&
          assistants &&
          assistants.length > 0
        ) {
          defaultGroup.members = [...assistants]
        }

        dispatch(updateGroups([...groups.filter((g) => g.id !== 'default'), defaultGroup]))
      },
      [dispatch]
    )
  }
}
