import { loggerService } from '@logger'
import { Center, VStack } from '@renderer/components/Layout'
import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import ProviderLogoPicker from '@renderer/components/ProviderLogoPicker'
import { HelpTooltip } from '@renderer/components/TooltipIcons'
import { TopView } from '@renderer/components/TopView'
import { PROVIDER_LOGO_MAP } from '@renderer/config/providers'
import ImageStorage from '@renderer/services/ImageStorage'
import type { Provider, ProviderType } from '@renderer/types'
import { compressImage, generateColorFromChar, getForegroundColor } from '@renderer/utils'
import { Divider, Dropdown, Form, Input, Modal, Popover, Select, Upload } from 'antd'
import type { ItemType } from 'antd/es/menu/interface'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('AddProviderPopup')

const API_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/

type PopupResult = {
  name: string
  type: ProviderType
  apiIdentifier?: string
  logo?: string
  logoFile?: File
}

interface Props {
  provider?: Provider
  existingProviders?: Provider[]
  resolve: (result: PopupResult) => void
}

const normalizeApiIdentifier = (value: string) => value.trim()

const isApiIdentifierConflicting = (
  identifier: string,
  providers: Provider[],
  currentProviderId: string | undefined
) => {
  const normalizedIdentifier = normalizeApiIdentifier(identifier)
  if (!normalizedIdentifier) {
    return false
  }

  return providers.some((p) => {
    if (p.id === currentProviderId) {
      return false
    }
    if (p.id === normalizedIdentifier) {
      return true
    }
    return normalizeApiIdentifier(p.apiIdentifier ?? '') === normalizedIdentifier
  })
}

const suggestApiIdentifier = (providerName: string) => {
  const base = providerName.trim().toLowerCase()
  if (!base) {
    return ''
  }

  const normalized = base
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+/, '')
    .replace(/[-_]+$/, '')

  const safeStart = normalized.replace(/^[^a-z0-9]+/, '')
  return safeStart.slice(0, 32)
}

const makeUniqueApiIdentifier = (
  baseIdentifier: string,
  providers: Provider[],
  currentProviderId: string | undefined
) => {
  const normalizedBase = normalizeApiIdentifier(baseIdentifier)
  if (!normalizedBase) {
    return ''
  }

  if (
    API_IDENTIFIER_PATTERN.test(normalizedBase) &&
    !normalizedBase.includes(':') &&
    !isApiIdentifierConflicting(normalizedBase, providers, currentProviderId)
  ) {
    return normalizedBase
  }

  for (let suffix = 2; suffix < 100; suffix++) {
    const suffixPart = `-${suffix}`
    const truncatedBase = normalizedBase.slice(0, Math.max(0, 32 - suffixPart.length))
    const candidate = `${truncatedBase}${suffixPart}`

    if (
      API_IDENTIFIER_PATTERN.test(candidate) &&
      !candidate.includes(':') &&
      !isApiIdentifierConflicting(candidate, providers, currentProviderId)
    ) {
      return candidate
    }
  }

  return ''
}

const PopupContainer: React.FC<Props> = ({ provider, existingProviders = [], resolve }) => {
  const [open, setOpen] = useState(true)
  const [name, setName] = useState(provider?.name || '')
  const [type, setType] = useState<ProviderType>(provider?.type || 'openai')
  const [displayType, setDisplayType] = useState<string>(provider?.type || 'openai')
  const [logo, setLogo] = useState<string | null>(null)
  const [apiIdentifier, setApiIdentifier] = useState(provider?.apiIdentifier ?? '')
  const [apiIdentifierEdited, setApiIdentifierEdited] = useState(!!provider)
  const [logoPickerOpen, setLogoPickerOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const { t } = useTranslation()
  const uploadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (provider?.id) {
      const loadLogo = async () => {
        try {
          const logoData = await ImageStorage.get(`provider-${provider.id}`)
          if (logoData) {
            setLogo(logoData)
          }
        } catch (error) {
          logger.error('Failed to load logo', error as Error)
        }
      }
      loadLogo()
    }
  }, [provider])

  const onOk = async () => {
    const normalizedIdentifier = normalizeApiIdentifier(apiIdentifier)
    if (apiIdentifierError) {
      window.toast.error(apiIdentifierError)
      return
    }

    setOpen(false)

    // 返回结果，但不包含文件对象，因为文件已经直接保存到 ImageStorage
    const result: PopupResult = {
      name,
      type,
      apiIdentifier: normalizedIdentifier || undefined,
      logo: logo || undefined
    }
    resolve(result)
  }

  const onCancel = () => {
    setOpen(false)
    resolve({ name: '', type: 'openai' })
  }

  const onClose = () => {
    resolve({ name, type, apiIdentifier: normalizeApiIdentifier(apiIdentifier) || undefined, logo: logo || undefined })
  }

  const apiIdentifierError = useMemo(() => {
    const normalizedIdentifier = normalizeApiIdentifier(apiIdentifier)

    if (!normalizedIdentifier) {
      return null
    }

    if (!API_IDENTIFIER_PATTERN.test(normalizedIdentifier) || normalizedIdentifier.includes(':')) {
      return t('settings.provider.api_identifier.error.invalid')
    }

    if (isApiIdentifierConflicting(normalizedIdentifier, existingProviders, provider?.id)) {
      return t('settings.provider.api_identifier.error.duplicate')
    }

    return null
  }, [apiIdentifier, existingProviders, provider?.id, t])

  const buttonDisabled = name.length === 0 || !!apiIdentifierError

  // 处理内置头像的点击事件
  const handleProviderLogoClick = async (providerId: string) => {
    try {
      const logoUrl = PROVIDER_LOGO_MAP[providerId]

      if (provider?.id) {
        await ImageStorage.set(`provider-${provider.id}`, logoUrl)
        const savedLogo = await ImageStorage.get(`provider-${provider.id}`)
        setLogo(savedLogo)
      } else {
        setLogo(logoUrl)
      }

      setLogoPickerOpen(false)
    } catch (error: any) {
      window.toast.error(error.message)
    }
  }

  const handleReset = async () => {
    try {
      setLogo(null)

      if (provider?.id) {
        await ImageStorage.set(`provider-${provider.id}`, '')
      }

      setDropdownOpen(false)
    } catch (error: any) {
      window.toast.error(error.message)
    }
  }

  const getInitials = () => {
    return name.charAt(0) || 'P'
  }

  const items = [
    {
      key: 'upload',
      label: (
        <Upload
          customRequest={() => {}}
          accept="image/png, image/jpeg, image/gif"
          itemRender={() => null}
          maxCount={1}
          onChange={async ({ file }) => {
            try {
              const _file = file.originFileObj as File
              let logoData: string | Blob

              if (_file.type === 'image/gif') {
                logoData = _file
              } else {
                logoData = await compressImage(_file)
              }

              if (provider?.id) {
                if (logoData instanceof Blob && !(logoData instanceof File)) {
                  const fileFromBlob = new File([logoData], 'logo.png', { type: logoData.type })
                  await ImageStorage.set(`provider-${provider.id}`, fileFromBlob)
                } else {
                  await ImageStorage.set(`provider-${provider.id}`, logoData)
                }
                const savedLogo = await ImageStorage.get(`provider-${provider.id}`)
                setLogo(savedLogo)
              } else {
                // 临时保存在内存中，等创建 provider 后会在调用方保存
                const tempUrl = await new Promise<string>((resolve) => {
                  const reader = new FileReader()
                  reader.onload = () => resolve(reader.result as string)
                  reader.readAsDataURL(logoData)
                })
                setLogo(tempUrl)
              }
              setDropdownOpen(false)
            } catch (error: any) {
              window.toast.error(error.message)
            }
          }}>
          <MenuItem ref={uploadRef}>{t('settings.general.image_upload')}</MenuItem>
        </Upload>
      ),
      onClick: (e: any) => {
        e.stopPropagation()
        uploadRef.current?.click()
      }
    },
    {
      key: 'builtin',
      label: <MenuItem>{t('settings.general.avatar.builtin')}</MenuItem>,
      onClick: () => {
        setDropdownOpen(false)
        setLogoPickerOpen(true)
      }
    },
    {
      key: 'reset',
      label: <MenuItem>{t('settings.general.avatar.reset')}</MenuItem>,
      onClick: handleReset
    }
  ] satisfies ItemType[]

  // for logo
  const backgroundColor = generateColorFromChar(name)
  const color = name ? getForegroundColor(backgroundColor) : 'white'

  return (
    <Modal
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      width={360}
      closable={false}
      transitionName="animation-move-down"
      centered
      title={t('settings.provider.add.title')}
      okButtonProps={{ disabled: buttonDisabled }}>
      <Divider style={{ margin: '8px 0' }} />

      <Center mt="10px" mb="20px">
        <VStack alignItems="center" gap="10px">
          <Dropdown
            menu={{ items }}
            trigger={['click']}
            open={dropdownOpen}
            align={{ offset: [0, 4] }}
            placement="bottom"
            onOpenChange={(visible) => {
              setDropdownOpen(visible)
              if (visible) {
                setLogoPickerOpen(false)
              }
            }}>
            <Popover
              content={<ProviderLogoPicker onProviderClick={handleProviderLogoClick} />}
              trigger="click"
              open={logoPickerOpen}
              onOpenChange={(visible) => {
                setLogoPickerOpen(visible)
                if (visible) {
                  setDropdownOpen(false)
                }
              }}
              placement="bottom">
              {logo ? (
                <ProviderLogo>
                  <ProviderAvatarPrimitive providerId={logo} providerName={name} logoSrc={logo} size={60} />
                </ProviderLogo>
              ) : (
                <ProviderInitialsLogo style={name ? { backgroundColor, color } : undefined}>
                  {getInitials()}
                </ProviderInitialsLogo>
              )}
            </Popover>
          </Dropdown>
        </VStack>
      </Center>

      <Form layout="vertical" style={{ gap: 8 }}>
        <Form.Item label={t('settings.provider.add.name.label')} style={{ marginBottom: 8 }}>
          <Input
            value={name}
            onChange={(e) => {
              const nextName = e.target.value.trim()
              setName(nextName)

              if (!provider && !apiIdentifierEdited) {
                const suggestedIdentifier = makeUniqueApiIdentifier(
                  suggestApiIdentifier(nextName),
                  existingProviders,
                  undefined
                )
                setApiIdentifier(suggestedIdentifier)
              }
            }}
            placeholder={t('settings.provider.add.name.placeholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                onOk()
              }
            }}
            maxLength={32}
          />
        </Form.Item>
        <Form.Item
          label={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {t('settings.provider.api_identifier.label')}
              <HelpTooltip title={t('settings.provider.api_identifier.tip')}></HelpTooltip>
            </span>
          }
          validateStatus={apiIdentifierError ? 'error' : undefined}
          help={
            apiIdentifierError
              ? apiIdentifierError
              : t('settings.provider.api_identifier.preview', {
                  model: `${normalizeApiIdentifier(apiIdentifier) || provider?.id || 'uuid'}:glm-4.6`
                })
          }
          style={{ marginBottom: 8 }}>
          <Input
            value={apiIdentifier}
            onChange={(e) => {
              setApiIdentifierEdited(true)
              setApiIdentifier(e.target.value)
            }}
            placeholder={t('settings.provider.api_identifier.placeholder')}
            spellCheck={false}
            maxLength={32}
          />
        </Form.Item>
        <Form.Item label={t('settings.provider.add.type')} style={{ marginBottom: 0 }}>
          <Select
            value={displayType}
            onChange={(value: string) => {
              setDisplayType(value)
              // special case for cherryin-type, map to new-api internally
              setType(value === 'cherryin-type' ? 'new-api' : (value as ProviderType))
            }}
            options={[
              { label: 'OpenAI', value: 'openai' },
              { label: 'OpenAI-Response', value: 'openai-response' },
              { label: 'Gemini', value: 'gemini' },
              { label: 'Anthropic', value: 'anthropic' },
              { label: 'Azure OpenAI', value: 'azure-openai' },
              { label: 'New API', value: 'new-api' },
              { label: 'CherryIN', value: 'cherryin-type' },
              { label: 'Ollama', value: 'ollama' }
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

const ProviderLogo = styled.div`
  cursor: pointer;
  width: 60px;
  height: 60px;
  border-radius: 100%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;

  transition: opacity 0.3s ease;
  &:hover {
    opacity: 0.8;
  }
`

const ProviderInitialsLogo = styled.div`
  cursor: pointer;
  width: 60px;
  height: 60px;
  border-radius: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30px;
  font-weight: 500;
  transition: opacity 0.3s ease;
  background-color: var(--color-background-soft);
  border: 0.5px solid var(--color-border);
  &:hover {
    opacity: 0.8;
  }
`

const MenuItem = styled.div`
  width: 100%;
  text-align: center;
`

export default class AddProviderPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('AddProviderPopup')
  }
  static show(provider?: Provider, params?: { existingProviders?: Provider[] }) {
    return new Promise<PopupResult>((resolve) => {
      TopView.show(
        <PopupContainer
          provider={provider}
          existingProviders={params?.existingProviders}
          resolve={(v) => {
            resolve(v)
            this.hide()
          }}
        />,
        'AddProviderPopup'
      )
    })
  }
}
