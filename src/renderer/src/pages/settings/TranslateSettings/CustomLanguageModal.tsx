import { CustomTranslateLanguage } from '@renderer/types'
import { Modal } from 'antd'
import { useTranslation } from 'react-i18next'

type Props = {
  isOpen: boolean
  onOK: () => void
  onCancel: () => void
  editingCustomLanguage?: CustomTranslateLanguage
}

const CustomLanguageModal = ({ isOpen, onOK, onCancel, editingCustomLanguage }: Props) => {
  const { t } = useTranslation()
  const title = (editingCustomLanguage ? t('common.edit') : t('common.add')) + t('translate.custom.label')
  return <Modal open={isOpen} title={title} onOk={onOK} onCancel={onCancel}></Modal>
}

export default CustomLanguageModal
