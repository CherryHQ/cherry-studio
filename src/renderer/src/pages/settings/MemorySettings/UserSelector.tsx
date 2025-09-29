import { Avatar, Button, Flex, RowFlex, Tooltip } from '@cherrystudio/ui'
import { Select } from 'antd'
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
        <RowFlex className="items-center gap-2.5">
          <Avatar className="h-5 w-5 bg-primary">
            {getUserAvatar(userId)}
          </Avatar>
          <span>{userName}</span>
        </RowFlex>
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
    <Flex className="gap-2">
      <Select value={currentUser} onChange={onUserSwitch} style={{ width: 200 }} options={options} />
      <Tooltip placement="top" title={t('memory.add_new_user')}>
        <Button size="sm" variant="solid" onPress={onAddUser} startContent={<UserRoundPlus size={16} />} isIconOnly />
      </Tooltip>
    </Flex>
  )
}

export default UserSelector
