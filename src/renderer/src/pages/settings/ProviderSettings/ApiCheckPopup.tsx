import { CheckCircleFilled, CloseCircleFilled, LoadingOutlined, MinusCircleOutlined } from '@ant-design/icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { TopView } from '@renderer/components/TopView'
import { checkApi } from '@renderer/services/ApiService'
import { Model } from '@renderer/types'
import { Provider } from '@renderer/types'
import { maskApiKey } from '@renderer/utils/api'
import { Button, List, Modal, Space, Spin, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

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
  const [isCheckingSingle, setIsCheckingSingle] = useState(false)

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

  const checkSingleKey = async (keyIndex: number) => {
    if (isChecking || keyStatuses[keyIndex].checking) {
      return
    }

    setIsCheckingSingle(true)
    setKeyStatuses((prev) => prev.map((status, idx) => (idx === keyIndex ? { ...status, checking: true } : status)))

    try {
      const { valid } = await checkApi({ ...provider, apiKey: keyStatuses[keyIndex].key }, model)

      setKeyStatuses((prev) =>
        prev.map((status, idx) => (idx === keyIndex ? { ...status, checking: false, isValid: valid } : status))
      )
    } catch (error) {
      setKeyStatuses((prev) =>
        prev.map((status, idx) => (idx === keyIndex ? { ...status, checking: false, isValid: false } : status))
      )
    } finally {
      setIsCheckingSingle(false)
    }
  }

  const removeInvalidKeys = () => {
    setKeyStatuses((prev) => prev.filter((status) => status.isValid !== false))
  }

  const removeKey = (keyIndex: number) => {
    setKeyStatuses((prev) => prev.filter((_, idx) => idx !== keyIndex))
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
            <Button key="remove" danger onClick={removeInvalidKeys} disabled={isChecking || isCheckingSingle}>
              {t('settings.provider.remove_invalid_keys')}
            </Button>
          </Space>
          <Space>
            <Button key="check" type="primary" ghost onClick={checkAllKeys} disabled={isChecking || isCheckingSingle}>
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
          renderItem={(status, index) => (
            <List.Item>
              <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <Typography.Text copyable={{ text: status.key }}>{maskApiKey(status.key)}</Typography.Text>
                <Space>
                  {status.checking && (
                    <Space>
                      <Spin indicator={<LoadingOutlined style={{ fontSize: 16 }} spin />} />
                    </Space>
                  )}
                  {status.isValid === true && !status.checking && <CheckCircleFilled style={{ color: '#52c41a' }} />}
                  {status.isValid === false && !status.checking && <CloseCircleFilled style={{ color: '#ff4d4f' }} />}
                  {status.isValid === undefined && !status.checking && (
                    <span>{t('settings.provider.not_checked')}</span>
                  )}
                  <Button size="small" onClick={() => checkSingleKey(index)} disabled={isChecking || isCheckingSingle}>
                    {t('settings.provider.check')}
                  </Button>
                  <RemoveIcon
                    onClick={() => !isChecking && !isCheckingSingle && removeKey(index)}
                    style={{
                      cursor: isChecking || isCheckingSingle ? 'not-allowed' : 'pointer',
                      opacity: isChecking || isCheckingSingle ? 0.5 : 1
                    }}
                  />
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

const RemoveIcon = styled(MinusCircleOutlined)`
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: var(--color-error);
  cursor: pointer;
  transition: all 0.2s ease-in-out;
`
