import { Flex } from '@cherrystudio/ui'
import { Button } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { TopView } from '@renderer/components/TopView'
import { useProviders } from '@renderer/hooks/useProviders'
import { getFancyProviderName } from '@renderer/pages/settings/ProviderSettingsV2/utils/provider'
import { getProviderHostTopology } from '@renderer/pages/settings/ProviderSettingsV2/utils/providerTopology'
import type { ProviderType } from '@renderer/types'
import { maskApiKey } from '@renderer/utils'
import { Descriptions, Modal } from 'antd'
import { Eye, EyeOff } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ShowParams {
  id: string
  apiKey: string
  baseUrl: string
  type?: ProviderType
  name?: string
}

interface ImportedProviderData {
  id: string
  name: string
  type: ProviderType
  apiKey: string
  apiHost: string
}

interface PopupResult {
  updatedProvider?: ImportedProviderData
  isNew: boolean
  displayName: string
}

interface Props extends ShowParams {
  resolve: (result: PopupResult) => void
}

const PopupContainer = ({ id, apiKey: newApiKey, baseUrl, type, name, resolve }: Props) => {
  const { t } = useTranslation()
  const { providers: rawProviders } = useProviders()
  const [open, setOpen] = useState(true)
  const [showFullKey, setShowFullKey] = useState(false)
  const providers = useMemo(() => (Array.isArray(rawProviders) ? rawProviders : []), [rawProviders])

  const foundProvider = providers.find((p) => p.id === id)
  const existingApiHost = getProviderHostTopology(foundProvider).primaryBaseUrl
  const { data: apiKeysData } = useQuery('/providers/:providerId/api-keys', {
    params: { providerId: id },
    enabled: foundProvider !== undefined
  })
  const baseProvider: ImportedProviderData = foundProvider
    ? {
        id: foundProvider.id,
        name: foundProvider.name,
        type: type || 'openai',
        apiKey: '',
        apiHost: existingApiHost
      }
    : {
        id,
        name: name || id,
        type: type || 'openai',
        apiKey: '',
        apiHost: baseUrl || ''
      }

  const displayName = foundProvider ? getFancyProviderName(foundProvider) : baseProvider.name
  const existingKeys = apiKeysData?.keys?.map((k) => k.key.trim()).filter(Boolean) ?? []
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
    const finalApiKey = keyAlreadyExists ? '' : trimmedNewKey
    const finalApiHost = baseUrlChanged ? baseUrl : baseProvider.apiHost

    if (finalApiKey === baseProvider.apiKey && finalApiHost === baseProvider.apiHost) {
      resolve({ updatedProvider: undefined, isNew: !foundProvider, displayName })
      return
    }

    const updatedProvider: ImportedProviderData = {
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
            <Flex className="justify-between">
              {showFullKey ? newApiKey : maskApiKey(newApiKey)}
              <Button variant="ghost" size="icon-sm" onClick={() => setShowFullKey((prev) => !prev)}>
                {showFullKey ? (
                  <Eye size={16} color="var(--color-text-3)" />
                ) : (
                  <EyeOff size={16} color="var(--color-text-3)" />
                )}
              </Button>
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
