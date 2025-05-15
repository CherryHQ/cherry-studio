import { TopView } from '@renderer/components/TopView'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useGroups } from '@renderer/hooks/useGroups'
import { Assistant, Group } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { Input, InputRef, Modal, Select, Space } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const { Option } = Select
interface Props {
  resolve: (value: Group | undefined) => void
  mode: 'add' | 'update'
  group?: Group
}

const PopupContainer: React.FC<Props> = ({ resolve, mode = 'add', group }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const { groups } = useGroups()
  const { assistants } = useAssistants()
  const [groupName, setGroupName] = useState(group?.name || '')
  const { getDefaultGroup } = useGroups()
  const inputRef = useRef<InputRef>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>(group?.members || [])
  const [filteredAssistants, setFilteredAssistants] = useState<Assistant[]>([])

  const onModifyGroup = useCallback(() => {
    const trimmedName = groupName.trim()
    // 空名称校验
    if (!trimmedName) {
      Modal.error({
        centered: true,
        title: t('common.warning'),
        content: t('assistants.group.emptyNameError')
      })
      return
    }
    // 重名校验
    if (groups.some((g) => g.name === trimmedName) && trimmedName !== group?.name) {
      Modal.error({
        centered: true,
        title: t('common.warning'),
        content: t('assistants.group.duplicateNameError')
      })
      return
    }

    if (mode === 'update') {
      const updatedGroup: Group = { ...group!, name: trimmedName, members: selectedIds }
      resolve(updatedGroup)
    }
    if (mode === 'add') {
      const newGroup: Group = {
        id: uuid(),
        name: trimmedName,
        members: selectedIds
      }
      resolve(newGroup)
    }
    setOpen(false)
  }, [groupName, groups, mode, t, group, selectedIds, resolve])

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = async () => {
    resolve(undefined)
    GroupPopup.hide()
  }

  useEffect(() => {
    const getDefaultGroupIds = getDefaultGroup()?.members.map((id) => id) || []
    setFilteredAssistants([
      ...assistants.filter((a) => getDefaultGroupIds.includes(a.id) || group?.members?.includes(a.id))
    ])
  }, [assistants, getDefaultGroup, group?.members])

  useEffect(() => {
    open && setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  return (
    <Modal
      centered
      open={open}
      onCancel={onCancel}
      closeIcon={null}
      afterClose={onClose}
      onOk={onModifyGroup}
      title={mode === 'add' ? t('assistants.group.addGroup') : t('assistants.group.modifyGroup')}
      okText={t('common.confirm')}
      cancelText={t('common.cancel')}
      transitionName="ant-move-up"
      styles={{
        content: {
          borderRadius: 20,
          padding: 20,
          overflow: 'hidden'
        }
      }}>
      <Space size={10} direction="vertical" style={{ width: '100%' }}>
        <Input
          ref={inputRef}
          placeholder={t('assistants.group.enterGroupName')}
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          onPressEnter={onModifyGroup}
          autoFocus
        />
        <Select
          mode="multiple"
          maxTagTextLength={5}
          maxCount={5}
          onClear={() => {
            setSelectedIds([])
          }}
          allowClear
          style={{ width: '100%' }}
          placeholder={t('assistants.group.selectMembers')}
          value={selectedIds}
          onChange={setSelectedIds}
          optionFilterProp="label"
          showSearch
          filterOption={(input, option) => (option?.label as string).toLowerCase().includes(input.toLowerCase())}>
          {filteredAssistants.map((a) => (
            <Option key={a.id} value={a.id} label={a.name}>
              <Space>
                {a.emoji}
                <span>{a.name}</span>
              </Space>
            </Option>
          ))}
        </Select>
      </Space>
    </Modal>
  )
}
const TopViewKey = 'GroupPopup'

interface PopUpProps {
  mode: 'add' | 'update'
  group?: Group
}
export default class GroupPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: PopUpProps) {
    return new Promise<Group | undefined>((resolve) => {
      TopView.show(<PopupContainer {...props} resolve={resolve} />, TopViewKey)
    })
  }
}
