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

  // 初始化时检查未分组的助手
  const groupedMemberIds = new Set<string>()
  groups.forEach((group) => {
    group.members.forEach((memberId) => groupedMemberIds.add(memberId))
  })

  const ungroupedAssistants = assistants.filter((a) => !groupedMemberIds.has(a.id))
  if (ungroupedAssistants.length > 0) {
    const defaultGroup = groups.find((g) => g.id === 'default') || {
      id: 'default',
      name: '未分组',
      members: []
    }
    const updatedDefaultGroup = {
      ...defaultGroup,
      members: [...defaultGroup.members, ...ungroupedAssistants.map((a) => a.id)]
    }
    console.log('updatedDefaultGroup', groups)
    dispatch(updateGroups([...groups.filter((g) => g.id !== 'default'), updatedDefaultGroup]))
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
    updateGroups: useCallback<(groups: Group[]) => void>(
      (groups) => {
        console.log('defaultGroup', groups)

        dispatch(updateGroups(groups))
      },
      [dispatch]
    )
  }
}
