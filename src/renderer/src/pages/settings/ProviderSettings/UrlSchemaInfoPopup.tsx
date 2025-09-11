import { TopView } from '@renderer/components/TopView'
import { useAllProviders } from '@renderer/hooks/useProvider'
import { Provider, ProviderType } from '@renderer/types'
import { getFancyProviderName, maskApiKey } from '@renderer/utils'
import { Button, Descriptions, Flex, Modal } from 'antd'
import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ShowParams {
  id: string
  apiKey: string
  baseUrl: string
  type?: ProviderType
  name?: string
}

interface PopupResult {
  updatedProvider?: Provider
  isNew: boolean
  displayName: string
}

interface Props extends ShowParams {
  resolve: (result: PopupResult) => void
}

const PopupContainer = ({ id, apiKey: newApiKey, baseUrl, type, name, resolve }: Props) => {
  const { t } = useTranslation()
  const providers = useAllProviders()
  const [open, setOpen] = useState(true)
  const [showFullKey, setShowFullKey] = useState(false)

  const foundProvider = providers.find((p) => p.id === id)
  const baseProvider: Provider = foundProvider ?? {
    id,
    name: name || id,
    type: type || 'openai',
    apiKey: '',
    apiHost: baseUrl || '',
    models: [],
    enabled: true,
    isSystem: false
  }

  const displayName = getFancyProviderName(baseProvider)
  const hasExistingKey = baseProvider.apiKey && baseProvider.apiKey.trim() !== ''
  const existingKeys = hasExistingKey
    ? baseProvider.apiKey
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
    : []
  const trimmedNewKey = newApiKey.trim()
  const keyAlreadyExists = existingKeys.includes(trimmedNewKey)
  const baseUrlChanged = Boolean(baseUrl) && baseUrl !== baseProvider.apiHost
  const okDisabled = keyAlreadyExists && !baseUrlChanged

  const confirmMessage = keyAlreadyExists
    ? t('settings.models.provider_key_already_exists', { provider: displayName })
    : t('settings.models.provider_key_add_confirm', { provider: displayName })

  const okText = keyAlreadyExists ? t('common.confirm') : t('common.add')

  const handleOk = () => {
    setOpen(false)
    const finalApiKey = keyAlreadyExists
      ? baseProvider.apiKey
      : hasExistingKey
        ? `${baseProvider.apiKey},${trimmedNewKey}`
        : trimmedNewKey
    const finalApiHost = baseUrlChanged ? baseUrl : baseProvider.apiHost

    if (finalApiKey === baseProvider.apiKey && finalApiHost === baseProvider.apiHost) {
      resolve({ updatedProvider: undefined, isNew: !foundProvider, displayName })
      return
    }

    const updatedProvider: Provider = {
      ...baseProvider,
      apiKey: finalApiKey,
      apiHost: finalApiHost
    }
    resolve({ updatedProvider, isNew: !foundProvider, displayName })
  }

  const handleCancel = () => {
    setOpen(false)
    resolve({ updatedProvider: undefined, isNew: !foundProvider, displayName })
  }

  return (
    <Modal
      title={t('settings.models.provider_key_confirm_title', { provider: displayName })}
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      okText={okText}
      okButtonProps={{ disabled: okDisabled }}
      cancelText={t('common.cancel')}
      width={500}
      transitionName="animation-move-down"
      centered>
      <Container>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label={t('settings.models.provider_name')}>{displayName}</Descriptions.Item>
          <Descriptions.Item label={t('settings.models.provider_id')}>{baseProvider.id}</Descriptions.Item>
          {baseUrl && <Descriptions.Item label={t('settings.models.base_url')}>{baseUrl}</Descriptions.Item>}
          <Descriptions.Item label={t('settings.models.api_key')}>
            <Flex justify="space-between">
              {showFullKey ? newApiKey : maskApiKey(newApiKey)}
              <Button
                type="link"
                size="small"
                icon={
                  showFullKey ? (
                    <Eye size={16} color="var(--color-text-3)" />
                  ) : (
                    <EyeOff size={16} color="var(--color-text-3)" />
                  )
                }
                onClick={() => setShowFullKey((prev) => !prev)}
              />
            </Flex>
          </Descriptions.Item>
        </Descriptions>
        <ConfirmMessage>{confirmMessage}</ConfirmMessage>
      </Container>
    </Modal>
  )
}

const Container = styled.div`
  margin-top: 12px;
  margin-bottom: 12px;
`

const ConfirmMessage = styled.div`
  color: var(--color-text);
  margin-top: 16px;
`

const TopViewKey = 'UrlSchemaInfoPopup'

export default class UrlSchemaInfoPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams) {
    return new Promise<PopupResult>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            this.hide()
          }}
        />,
        TopViewKey
      )
    })
  }
}
