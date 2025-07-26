import { TopView } from '@renderer/components/TopView'
import { useProvider } from '@renderer/hooks/useProvider'
import { Provider } from '@renderer/types'
import { Checkbox, Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ShowParams {
  provider: Provider
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ resolve, ...props }) => {
  const [open, setOpen] = useState(true)
  const [isNotSupportArrayContent, setIsNotSupportArrayContent] = useState(props.provider.isNotSupportArrayContent)

  const { provider, updateProvider } = useProvider(props.provider.id)

  const { t } = useTranslation()

  const onOk = () => {
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  ProviderSettingsPopup.hide = onCancel

  return (
    <Modal
      title={provider.name}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      transitionName="animation-move-down"
      centered>
      <Checkbox
        checked={isNotSupportArrayContent}
        onChange={(e) => {
          setIsNotSupportArrayContent(e.target.checked)
          updateProvider({ ...provider, isNotSupportArrayContent: e.target.checked })
        }}>
        {t('settings.provider.is_not_support_array_content')}
      </Checkbox>
    </Modal>
  )
}

const TopViewKey = 'ProviderSettingsPopup'

/**
 * @deprecated
 */
export default class ProviderSettingsPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
