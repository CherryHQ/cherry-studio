import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addGroup,
  addMemberToGroup,
  defaultGroupId,
  defaultGroupName,
  initializeGroups,
  removeGroup,
  removeMemberFromGroup,
  updateGroup,
  updateGroups
} from '@renderer/store/groups'
import { Group } from '@renderer/types'
import { useCallback } from 'react'

export function useGroups() {
  const { groups, expandGroupIds } = useAppSelector((state) => state.groups)
  const { assistants } = useAppSelector((state) => state.assistants)
  const dispatch = useAppDispatch()

  const getDefaultGroup = useCallback(() => groups.find((g) => g.id === defaultGroupId), [groups])

  const addGroupHandler = useCallback(
    (group: Group) => {
      if (group.id === defaultGroupId) return
      dispatch(addGroup(group))
    },
    [dispatch]
  )

  const removeGroupHandler = useCallback(
    (id: string) => {
      if (id === defaultGroupId) return
      dispatch(removeGroup({ id }))
    },
    [dispatch]
  )

  const updateGroupHandler = useCallback(
    (group: Group) => {
      if (group.id === defaultGroupId) return
      dispatch(updateGroup(group))
    },
    [dispatch]
  )

  const addMemberToGroupHandler = useCallback(
    (groupId: string, memberId: string) => {
      if (groupId === defaultGroupId) return
      dispatch(addMemberToGroup({ groupId, memberId }))
    },
    [dispatch]
  )

  const removeMemberFromGroupHandler = useCallback(
    (groupId: string, memberId: string) => {
      if (groupId === defaultGroupId) return
      dispatch(removeMemberFromGroup({ groupId, memberId }))
    },
    [dispatch]
  )

  const updateGroupsHandler = useCallback<(groups: Group[]) => void>(
    (groups) => {
      dispatch(updateGroups(groups))
    },
    [dispatch]
  )

  // 初始化时检查未分组的助手
  const groupedMemberIds = new Set<string>()
  groups.forEach((group) => {
    group.members.forEach((memberId) => groupedMemberIds.add(memberId))
  })

  const ungroupedAssistants = assistants.filter((a) => !groupedMemberIds.has(a.id))
  if (ungroupedAssistants.length > 0) {
    const defaultGroup = groups.find((g) => g.id === defaultGroupId) || {
      id: defaultGroupId,
      name: defaultGroupName,
      members: []
    }
    const updatedDefaultGroup = {
      ...defaultGroup,
      members: [...defaultGroup.members, ...ungroupedAssistants.map((a) => a.id)]
    }
    dispatch(updateGroups([...groups.filter((g) => g.id !== defaultGroupId), updatedDefaultGroup]))
  }

  const moveAssistantBetweenGroups = useCallback(
    (sourceGroupId: string, sourceIndex: number, destGroupId: string, destIndex: number, groups: Group[]) => {
      const sourceGroup = groups.find((g) => g.id === sourceGroupId)
      const destGroup = groups.find((g) => g.id === destGroupId)
      if (!sourceGroup || !destGroup) return groups

      // 处理移动到未分组的情况
      if (!destGroupId) {
        if (sourceGroupId === defaultGroupId) return groups // 未分组不能再移动到未分组

        const sourceMembers = [...sourceGroup.members]
        const [removed] = sourceMembers.splice(sourceIndex, 1)

        const defaultGroup = groups.find((g) => g.id === defaultGroupId) || {
          id: defaultGroupId,
          name: defaultGroupName,
          members: []
        }
        const updatedDefaultGroup = {
          ...defaultGroup,
          members: [...defaultGroup.members, removed]
        }

        return groups.map((group) => {
          if (group.id === sourceGroupId) {
            return { ...sourceGroup, members: sourceMembers }
          }
          if (group.id === defaultGroupId) {
            return updatedDefaultGroup
          }
          return group
        })
      }

      // 同组内调整顺序
      if (sourceGroupId === destGroupId) {
        const newMembers = [...sourceGroup.members]
        const [removed] = newMembers.splice(sourceIndex, 1)
        newMembers.splice(destIndex, 0, removed)

        return groups.map((group) => (group.id === sourceGroupId ? { ...group, members: newMembers } : group))
      }

      // 跨组移动
      const sourceMembers = [...sourceGroup.members]
      const [removed] = sourceMembers.splice(sourceIndex, 1)

      const destMembers = [...destGroup.members]
      destMembers.splice(destIndex, 0, removed)

      return groups.map((group) => {
        if (group.id === sourceGroupId) {
          return { ...group, members: sourceMembers }
        }
        if (group.id === destGroupId) {
          return { ...group, members: destMembers }
        }
        return group
      })
    },
    []
  )

  const reorderGroups = useCallback((sourceIndex: number, destIndex: number, groups: Group[]) => {
    const newGroups = [...groups]
    const [removed] = newGroups.splice(sourceIndex, 1)
    newGroups.splice(destIndex, 0, removed)
    return newGroups
  }, [])

  const updateGroupWithMembers = useCallback((groupId: string, newMembers: string[], groups: Group[]) => {
    const targetGroup = groups.find((g) => g.id === groupId)
    if (!targetGroup) return groups

    const originGroupMembers = targetGroup.members
    // 更新目标组
    const updatedGroups = groups.map((group) => {
      if (group.id === groupId) {
        return { ...group, members: [...newMembers] }
      }
      if (group.id === defaultGroupId) {
        return {
          ...group,
          members: [...originGroupMembers, ...group.members].filter((id) => !newMembers.includes(id))
        }
      }
      return group
    })

    return updatedGroups
  }, [])

  const initializeGroupsHandler = useCallback(
    (assistantIds: string[]) => {
      dispatch(initializeGroups({ assistantIds }))
    },
    [dispatch]
  )

  return {
    groups,
    expandGroupIds,
    defaultGroupId,
    getDefaultGroup,
    addGroup: addGroupHandler,
    removeGroup: removeGroupHandler,
    updateGroup: updateGroupHandler,
    addMemberToGroup: addMemberToGroupHandler,
    removeMemberFromGroup: removeMemberFromGroupHandler,
    updateGroups: updateGroupsHandler,
    moveAssistantBetweenGroups,
    reorderGroups,
    initializeGroups: initializeGroupsHandler,
    updateGroupWithMembers
  }
}
