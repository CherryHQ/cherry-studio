import { TopView } from '@renderer/components/TopView'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useGroups } from '@renderer/hooks/useGroups'
import { Assistant } from '@renderer/types'
import { Modal, Select, Space } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const { Option } = Select

interface Props {
  resolve: (value: string[] | undefined) => void
}

const PopupContainer: FC<Props> = ({ resolve }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const { assistants } = useAssistants()
  const { getDefaultGroup } = useGroups()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [filteredAssistants, setFilteredAssistants] = useState<Assistant[]>([])

  const onCancel = () => {
    setOpen(false)
  }
  const onClose = async () => {
    resolve(undefined)
    AddMemberToGroupPopup.hide()
  }
  useEffect(() => {
    const getDefaultGroupIds = getDefaultGroup()?.members.map((id) => id) || []
    // 如果有传入可用的成员ID，优先使用；否则过滤掉已在组中的成员
    setFilteredAssistants(assistants.filter((a) => getDefaultGroupIds.includes(a.id)))
  }, [assistants, getDefaultGroup])

  return (
    <Modal
      centered
      open={open}
      onCancel={onCancel}
      closeIcon={null}
      afterClose={onClose}
      onOk={() => resolve(selectedIds)}
      okText={t('common.confirm')}
      title={t('chat.group.addMembers')}
      cancelText={t('common.cancel')}
      transitionName="ant-move-up"
      styles={{
        content: {
          borderRadius: 20,
          padding: 20,
          overflow: 'hidden'
        }
      }}>
      <Select
        mode="multiple"
        maxTagTextLength={5}
        style={{ width: '100%' }}
        placeholder={t('chat.group.selectMembers')}
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
    </Modal>
  )
}

const TopViewKey = 'AddMemberToGroupPopup'

export default class AddMemberToGroupPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show() {
    return new Promise<string[] | undefined>((resolve) => {
      TopView.show(<PopupContainer resolve={resolve} />, TopViewKey)
    })
  }
}
