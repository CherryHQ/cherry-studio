import CustomTag from '@renderer/components/CustomTag'
import { HStack } from '@renderer/components/Layout'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { Avatar, Button, Select, Space, Tooltip } from 'antd'
import { UserRoundPlus } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { DEFAULT_USER_ID } from './constants'

interface UserSelectorProps {
  currentUser: string
  uniqueUsers: string[]
  onUserSwitch: (userId: string) => void
  onAddUser: () => void
}

const UserSelector: React.FC<UserSelectorProps> = ({ currentUser, uniqueUsers, onUserSwitch, onAddUser }) => {
  const { t } = useTranslation()
  const { assistants } = useAssistants()

  const getUserAvatar = useCallback((user: string) => {
    return user === DEFAULT_USER_ID ? user.slice(0, 1).toUpperCase() : user.slice(0, 2).toUpperCase()
  }, [])

  // Get assistants linked to a specific memory user
  const getAssistantsForUser = useCallback(
    (userId: string) => {
      return assistants.filter(
        (assistant) =>
          // Assistant uses this user if either:
          // 1. memoryUserId explicitly matches
          // 2. memoryUserId is undefined and this is the current global user
          assistant.memoryUserId === userId || (!assistant.memoryUserId && userId === currentUser)
      )
    },
    [assistants, currentUser]
  )

  const renderLabel = useCallback(
    (userId: string, userName: string) => {
      const linkedAssistants = getAssistantsForUser(userId)

      return (
        <HStack alignItems="center" justifyContent="space-between" style={{ width: '100%' }}>
          <HStack alignItems="center" gap={8} style={{ minWidth: 0 }}>
            <Avatar size={20} style={{ background: 'var(--color-primary)' }}>
              {getUserAvatar(userId)}
            </Avatar>
            <span style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{userName}</span>
          </HStack>
          {linkedAssistants.length > 0 && (
            <CustomTag
              color="#8c8c8c"
              size={10}
              tooltip={`Linked Assistants: ${linkedAssistants.map((a) => a.name).join(', ')}`}>
              {linkedAssistants.length}
            </CustomTag>
          )}
        </HStack>
      )
    },
    [getUserAvatar, getAssistantsForUser]
  )

  const options = useMemo(() => {
    const defaultOption = {
      value: DEFAULT_USER_ID,
      label: renderLabel(DEFAULT_USER_ID, t('memory.default_user'))
    }

    const userOptions = uniqueUsers
      .filter((user) => user !== DEFAULT_USER_ID)
      .map((user) => ({
        value: user,
        label: renderLabel(user, user)
      }))

    return [defaultOption, ...userOptions]
  }, [renderLabel, t, uniqueUsers])

  return (
    <Space.Compact>
      <Select value={currentUser} onChange={onUserSwitch} style={{ width: 200 }} options={options} />
      <Tooltip title={t('memory.add_new_user')}>
        <Button type="default" onClick={onAddUser} icon={<UserRoundPlus size={16} />} />
      </Tooltip>
    </Space.Compact>
  )
}

export default UserSelector
