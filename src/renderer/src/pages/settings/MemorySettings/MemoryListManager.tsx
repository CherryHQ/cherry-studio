import { DeleteOutlined, EditOutlined, ExclamationCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addMemoryList,
  deleteMemoryList,
  editMemoryList,
  MemoryList,
  setCurrentMemoryList,
  toggleMemoryListActive
} from '@renderer/store/memory'
import { Button, Empty, Input, List, Modal, Switch, Tooltip, Typography } from 'antd'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const { Title } = Typography
const { confirm } = Modal

interface MemoryListManagerProps {
  onSelectList?: (listId: string) => void
}

const MemoryListManager: React.FC<MemoryListManagerProps> = ({ onSelectList }) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const memoryLists = useAppSelector((state) => state.memory?.memoryLists || [])
  const currentListId = useAppSelector((state) => state.memory?.currentListId)

  const [isModalVisible, setIsModalVisible] = useState(false)
  const [editingList, setEditingList] = useState<MemoryList | null>(null)
  const [newListName, setNewListName] = useState('')
  const [newListDescription, setNewListDescription] = useState('')

  // 打开添加/编辑列表的模态框
  const showModal = (list?: MemoryList) => {
    if (list) {
      setEditingList(list)
      setNewListName(list.name)
      setNewListDescription(list.description || '')
    } else {
      setEditingList(null)
      setNewListName('')
      setNewListDescription('')
    }
    setIsModalVisible(true)
  }

  // 处理模态框确认
  const handleOk = () => {
    if (!newListName.trim()) {
      return // 名称不能为空
    }

    if (editingList) {
      // 编辑现有列表
      dispatch(
        editMemoryList({
          id: editingList.id,
          name: newListName,
          description: newListDescription
        })
      )
    } else {
      // 添加新列表
      dispatch(
        addMemoryList({
          name: newListName,
          description: newListDescription,
          isActive: false
        })
      )
    }

    setIsModalVisible(false)
    setNewListName('')
    setNewListDescription('')
    setEditingList(null)
  }

  // 处理模态框取消
  const handleCancel = () => {
    setIsModalVisible(false)
    setNewListName('')
    setNewListDescription('')
    setEditingList(null)
  }

  // 删除记忆列表
  const handleDelete = (list: MemoryList) => {
    confirm({
      title: t('settings.memory.confirmDeleteList'),
      icon: <ExclamationCircleOutlined />,
      content: t('settings.memory.confirmDeleteListContent', { name: list.name }),
      okText: t('common.delete'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk() {
        dispatch(deleteMemoryList(list.id))
      }
    })
  }

  // 切换列表激活状态
  const handleToggleActive = (list: MemoryList, checked: boolean) => {
    dispatch(toggleMemoryListActive({ id: list.id, isActive: checked }))
  }

  // 选择列表
  const handleSelectList = (listId: string) => {
    dispatch(setCurrentMemoryList(listId))
    if (onSelectList) {
      onSelectList(listId)
    }
  }

  return (
    <Container>
      <Header>
        <Title level={4}>{t('settings.memory.memoryLists')}</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => showModal()}>
          {t('settings.memory.addList')}
        </Button>
      </Header>

      {memoryLists.length === 0 ? (
        <Empty description={t('settings.memory.noLists')} />
      ) : (
        <List
          dataSource={memoryLists}
          renderItem={(list) => (
            <ListItem onClick={() => handleSelectList(list.id)} $isActive={list.id === currentListId}>
              <ListItemContent>
                <div>
                  <ListItemTitle>{list.name}</ListItemTitle>
                  {list.description && <ListItemDescription>{list.description}</ListItemDescription>}
                </div>
                <ListItemActions onClick={(e) => e.stopPropagation()}>
                  <Tooltip title={t('settings.memory.toggleActive')}>
                    <Switch
                      checked={list.isActive}
                      onChange={(checked) => handleToggleActive(list, checked)}
                      size="small"
                    />
                  </Tooltip>
                  <Tooltip title={t('common.edit')}>
                    <Button
                      icon={<EditOutlined />}
                      type="text"
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation()
                        showModal(list)
                      }}
                    />
                  </Tooltip>
                  <Tooltip title={t('common.delete')}>
                    <Button
                      icon={<DeleteOutlined />}
                      type="text"
                      size="small"
                      danger
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(list)
                      }}
                      disabled={memoryLists.length <= 1} // 至少保留一个列表
                    />
                  </Tooltip>
                </ListItemActions>
              </ListItemContent>
            </ListItem>
          )}
        />
      )}

      <Modal
        title={editingList ? t('settings.memory.editList') : t('settings.memory.addList')}
        open={isModalVisible}
        onOk={handleOk}
        onCancel={handleCancel}
        okButtonProps={{ disabled: !newListName.trim() }}>
        <FormItem>
          <Label>{t('settings.memory.listName')}</Label>
          <Input
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            placeholder={t('settings.memory.listNamePlaceholder')}
            maxLength={50}
          />
        </FormItem>
        <FormItem>
          <Label>{t('settings.memory.listDescription')}</Label>
          <Input.TextArea
            value={newListDescription}
            onChange={(e) => setNewListDescription(e.target.value)}
            placeholder={t('settings.memory.listDescriptionPlaceholder')}
            maxLength={200}
            rows={3}
          />
        </FormItem>
      </Modal>
    </Container>
  )
}

const Container = styled.div`
  margin-bottom: 20px;
`

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
`

const ListItem = styled.div<{ $isActive: boolean }>`
  padding: 12px;
  border-radius: 4px;
  cursor: pointer;
  background-color: ${(props) => (props.$isActive ? 'var(--color-bg-2)' : 'transparent')};
  border: 1px solid ${(props) => (props.$isActive ? 'var(--color-primary)' : 'var(--color-border)')};
  margin-bottom: 8px;

  &:hover {
    background-color: var(--color-bg-2);
  }
`

const ListItemContent = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`

const ListItemTitle = styled.div`
  font-weight: 500;
  margin-bottom: 4px;
`

const ListItemDescription = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
`

const ListItemActions = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
`

const FormItem = styled.div`
  margin-bottom: 16px;
`

const Label = styled.div`
  margin-bottom: 8px;
  font-weight: 500;
`

export default MemoryListManager
