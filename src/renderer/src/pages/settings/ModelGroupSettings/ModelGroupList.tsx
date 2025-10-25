import { ModelGroup } from '@renderer/types'
import { Empty } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

import ModelGroupItem from './ModelGroupItem'

interface Props {
  groups: ModelGroup[]
  onEdit: (group: ModelGroup) => void
  onDelete: (groupId: string) => void
}

const ModelGroupList: FC<Props> = ({ groups, onEdit, onDelete }) => {
  const { t } = useTranslation()

  if (groups.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <div>
            <div>{t('settings.modelGroup.noGroups')}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-3)', marginTop: 4 }}>
              {t('settings.modelGroup.createFirst')}
            </div>
          </div>
        }
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {groups.map((group) => (
        <ModelGroupItem key={group.id} group={group} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </div>
  )
}

export default ModelGroupList
