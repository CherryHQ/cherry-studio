import { HStack } from '@renderer/components/Layout'
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

  const getUserAvatar = useCallback((user: string) => {
    return user === DEFAULT_USER_ID ? user.slice(0, 1).toUpperCase() : user.slice(0, 2).toUpperCase()
  }, [])

  const renderLabel = useCallback(
    (userId: string, userName: string) => {
      return (
        <HStack alignItems="center" gap={10}>
          <Avatar size={20} style={{ background: 'var(--color-primary)' }}>
            {getUserAvatar(userId)}
          </Avatar>
          <span>{userName}</span>
        </HStack>
      )
    },
    [getUserAvatar]
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
