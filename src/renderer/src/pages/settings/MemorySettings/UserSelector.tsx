import { Button, Select, Space, Tooltip } from 'antd'
import { UserRoundPlus } from 'lucide-react'
import { useMemo } from 'react'
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

  const options = useMemo(() => {
    const defaultOption = {
      value: DEFAULT_USER_ID,
      label: t('memory.default_user')
    }

    const userOptions = uniqueUsers
      .filter((user) => user !== DEFAULT_USER_ID)
      .map((user) => ({ value: user, label: user }))

    return [defaultOption, ...userOptions]
  }, [t, uniqueUsers])

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
