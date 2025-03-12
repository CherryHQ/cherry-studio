import { CheckCircleFilled, CloseCircleFilled, LoadingOutlined } from '@ant-design/icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { TopView } from '@renderer/components/TopView'
import { checkApi } from '@renderer/services/ApiService'
import { Model } from '@renderer/types'
import { Provider } from '@renderer/types'
import { Button, List, Modal, Space, Spin, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ShowParams {
  title: string
  provider: Provider
  model: Model
  apiKeys: string[]
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

interface KeyStatus {
  key: string
  isValid?: boolean
  checking?: boolean
}

const PopupContainer: React.FC<Props> = ({ title, provider, model, apiKeys, resolve }) => {
  const [open, setOpen] = useState(true)
  const [keyStatuses, setKeyStatuses] = useState<KeyStatus[]>(() => {
    const uniqueKeys = new Set(apiKeys)
    return Array.from(uniqueKeys).map((key) => ({ key }))
  })
  const { t } = useTranslation()
  const [isChecking, setIsChecking] = useState(false)

  const checkAllKeys = async () => {
    setIsChecking(true)
    const newStatuses = [...keyStatuses]

    try {
      for (let i = 0; i < newStatuses.length; i++) {
        setKeyStatuses((prev) => prev.map((status, idx) => (idx === i ? { ...status, checking: true } : status)))

        const { valid } = await checkApi({ ...provider, apiKey: newStatuses[i].key }, model)

        setKeyStatuses((prev) =>
          prev.map((status, idx) => (idx === i ? { ...status, checking: false, isValid: valid } : status))
        )
      }
    } finally {
      setIsChecking(false)
    }
  }

  const removeInvalidKeys = () => {
    setKeyStatuses((prev) => prev.filter((status) => status.isValid !== false))
  }

  const onOk = () => {
    const allKeys = keyStatuses.map((status) => status.key)
    resolve({ validKeys: allKeys })
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  return (
    <Modal
      title={title}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      centered
      maskClosable={false}
      footer={
        <Space style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Space>
            <Button key="remove" danger onClick={removeInvalidKeys}>
              {t('settings.provider.remove_invalid_keys')}
            </Button>
          </Space>
          <Space>
            <Button key="check" type="primary" ghost onClick={checkAllKeys} disabled={isChecking}>
              {t('settings.provider.check_all_keys')}
            </Button>
            <Button key="save" type="primary" onClick={onOk}>
              {t('common.save')}
            </Button>
          </Space>
        </Space>
      }>
      <Scrollbar style={{ maxHeight: '70vh', overflowX: 'hidden' }}>
        <List
          dataSource={keyStatuses}
          renderItem={(status) => (
            <List.Item>
              <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <Typography.Text copyable={{ text: status.key }}>
                  {status.key.slice(0, 8)}...{status.key.slice(-8)}
                </Typography.Text>
                <Space>
                  {status.checking && (
                    <Space>
                      <Spin indicator={<LoadingOutlined style={{ fontSize: 16 }} spin />} />
                    </Space>
                  )}
                  {status.isValid === true && <CheckCircleFilled style={{ color: '#52c41a' }} />}
                  {status.isValid === false && <CloseCircleFilled style={{ color: '#ff4d4f' }} />}
                  {status.isValid === undefined && !status.checking && (
                    <span>{t('settings.provider.not_checked')}</span>
                  )}
                </Space>
              </Space>
            </List.Item>
          )}
        />
      </Scrollbar>
    </Modal>
  )
}

export default class ApiCheckPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('ApiCheckPopup')
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            this.hide()
          }}
        />,
        'ApiCheckPopup'
      )
    })
  }
}
