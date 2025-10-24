import { useTheme } from '@renderer/context/ThemeProvider'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { addModelGroup, removeModelGroup, updateModelGroup } from '@renderer/store/modelGroups'
import { ModelGroup } from '@renderer/types'
import { Button } from 'antd'
import { Plus } from 'lucide-react'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingGroup, SettingSubtitle, SettingTitle } from '..'
import CreateModelGroupModal from './CreateModelGroupModal'
import ModelGroupList from './ModelGroupList'

const ModelGroupSettings: FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const modelGroups = useAppSelector((state) => state.modelGroups.groups)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<ModelGroup | null>(null)
  const { theme: themeMode } = useTheme()

  const handleCreate = () => {
    setEditingGroup(null)
    setIsModalOpen(true)
  }

  const handleEdit = (group: ModelGroup) => {
    setEditingGroup(group)
    setIsModalOpen(true)
  }

  const handleDelete = (groupId: string) => {
    dispatch(removeModelGroup(groupId))
  }

  const handleSave = (group: Omit<ModelGroup, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (editingGroup) {
      dispatch(updateModelGroup({ ...editingGroup, ...group }))
    } else {
      dispatch(addModelGroup(group))
    }
    setIsModalOpen(false)
  }

  return (
    <SettingContainer theme={themeMode}>
      <SettingTitle>{t('settings.modelGroup.title')}</SettingTitle>
      <SettingSubtitle>{t('settings.modelGroup.subtitle')}</SettingSubtitle>

      <SettingGroup theme={themeMode}>
        <div style={{ marginBottom: 16 }}>
          <Button type="primary" icon={<Plus size={16} />} onClick={handleCreate}>
            {t('settings.modelGroup.create')}
          </Button>
        </div>

        <ModelGroupList groups={modelGroups} onEdit={handleEdit} onDelete={handleDelete} />
      </SettingGroup>

      <CreateModelGroupModal
        open={isModalOpen}
        group={editingGroup}
        onSave={handleSave}
        onCancel={() => setIsModalOpen(false)}
      />
    </SettingContainer>
  )
}

export default ModelGroupSettings