import { isWin } from '@renderer/config/constant'
import { Button, Form, Input, Modal } from 'antd'
import { FC, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface SelectionFilterListModalProps {
  open: boolean
  onClose: () => void
  filterList?: string[]
  onSave: (list: string[]) => void
}

const SelectionFilterListModal: FC<SelectionFilterListModalProps> = ({ open, onClose, filterList = [], onSave }) => {
  const { t } = useTranslation()
  const [form] = Form.useForm()

  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        filterList: (filterList || []).join('\n')
      })
    }
  }, [open, filterList, form])

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      const newList = (values.filterList as string)
        .trim()
        .toLowerCase()
        .split('\n')
        .map((line: string) => line.trim().slice(0, 32))
        .filter((line: string) => line.length > 0)
      onSave([...new Set(newList)])
      onClose()
    } catch (error) {
      // validation failed
    }
  }

  return (
    <Modal
      title={t('selection.settings.filter_modal.title')}
      open={open}
      onCancel={onClose}
      maskClosable={false}
      keyboard={true}
      destroyOnClose={true}
      footer={[
        <Button key="modal-cancel" onClick={onClose}>
          {t('common.cancel')}
        </Button>,
        <Button key="modal-save" type="primary" onClick={handleSave}>
          {t('common.save')}
        </Button>
      ]}>
      <UserTip>
        {isWin
          ? t('selection.settings.filter_modal.user_tips.windows')
          : t('selection.settings.filter_modal.user_tips.mac')}
      </UserTip>
      <Form form={form} layout="vertical" initialValues={{ filterList: '' }}>
        <Form.Item name="filterList" noStyle>
          <StyledTextArea autoSize={{ minRows: 6, maxRows: 16 }} spellCheck={false} autoFocus />
        </Form.Item>
      </Form>
    </Modal>
  )
}

const StyledTextArea = styled(Input.TextArea)`
  margin-top: 16px;
  width: 100%;
`

const UserTip = styled.div`
  font-size: 14px;
`

export default SelectionFilterListModal
