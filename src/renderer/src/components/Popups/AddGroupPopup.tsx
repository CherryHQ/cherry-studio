import { TopView } from '@renderer/components/TopView'
import { useGroups } from '@renderer/hooks/useGroups'
import { Group } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { Input, InputRef, Modal } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  resolve: (value: Group | undefined) => void
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const { addGroup, groups } = useGroups()
  const [groupName, setGroupName] = useState('')
  const inputRef = useRef<InputRef>(null)

  const onCreateGroup = useCallback(() => {
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
    if (groups.some((g) => g.name === trimmedName)) {
      Modal.error({
        centered: true,
        title: t('common.warning'),
        content: t('assistants.group.duplicateNameError')
      })
      return
    }

    const newGroup: Group = {
      id: uuid(),
      name: trimmedName,
      members: []
    }
    addGroup(newGroup)
    resolve(newGroup)
    setOpen(false)
  }, [groupName, addGroup, resolve, t, groups])

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = async () => {
    resolve(undefined)
    AddGroupPopup.hide()
  }

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
      onOk={onCreateGroup}
      title={t('assistants.group.addGroup')}
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
      <Input
        ref={inputRef}
        placeholder={t('assistants.group.enterGroupName')}
        value={groupName}
        onChange={(e) => setGroupName(e.target.value)}
        onPressEnter={onCreateGroup}
        allowClear
        autoFocus
      />
    </Modal>
  )
}
const TopViewKey = 'AddGroupPopup'

export default class AddGroupPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show() {
    return new Promise<Group | undefined>((resolve) => {
      TopView.show(<PopupContainer resolve={resolve} />, TopViewKey)
    })
  }
}
