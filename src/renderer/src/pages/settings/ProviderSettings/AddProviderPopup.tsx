import { Center, VStack } from '@renderer/components/Layout'
import ProviderLogoPicker from '@renderer/components/ProviderLogoPicker'
import { TopView } from '@renderer/components/TopView'
import { PROVIDER_LOGO_MAP } from '@renderer/config/providers'
import { useProviderAvatar } from '@renderer/hooks/useProviderLogo'
import ImageStorage from '@renderer/services/ImageStorage'
import { Provider, ProviderType } from '@renderer/types'
import { compressImage } from '@renderer/utils'
import { Divider, Dropdown, Form, Input, Modal, Popover, Select, Upload } from 'antd'
import { ItemType } from 'antd/es/menu/interface'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

// const logger = loggerService.withContext('AddProviderPopup')

interface Props {
  provider?: Provider
  resolve: (result: { name: string; type: ProviderType; logo?: string; logoFile?: File }) => void
}

const PopupContainer: React.FC<Props> = ({ provider, resolve }) => {
  const [open, setOpen] = useState(true)
  const [name, setName] = useState(provider?.name || '')
  const [type, setType] = useState<ProviderType>(provider?.type || 'openai')
  const [logoPickerOpen, setLogoPickerOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const { t } = useTranslation()
  const uploadRef = useRef<HTMLDivElement>(null)
  const [logo, setLogo] = useState<string>()

  const { ProviderAvatar, logos, saveLogo } = useProviderAvatar()

  useEffect(() => {
    if (provider) {
      const logo = logos[provider.id]
      setLogo(logo)
    }
  }, [provider, logos, setLogo])

  const onOk = async () => {
    setOpen(false)

    // 返回结果，但不包含文件对象，因为文件已经直接保存到 ImageStorage
    const result = {
      name,
      type,
      logo: logo || undefined
    }
    resolve(result)
  }

  const onCancel = () => {
    setOpen(false)
    resolve({ name: '', type: 'openai' })
  }

  const onClose = () => {
    resolve({ name, type, logo: logo || undefined })
  }

  const buttonDisabled = name.length === 0

  // 处理内置头像的点击事件
  const handleProviderLogoClick = async (providerId: string) => {
    try {
      const logoUrl = PROVIDER_LOGO_MAP[providerId]

      if (provider?.id) {
        saveLogo(logoUrl, provider.id)
      }
      setLogo(logoUrl)

      setLogoPickerOpen(false)
    } catch (error: any) {
      window.message.error(error.message)
    }
  }

  const handleReset = async () => {
    try {
      if (provider?.id) {
        saveLogo('', provider.id)
        ImageStorage.set(`provider-${provider.id}`, '')
      }

      setDropdownOpen(false)
    } catch (error: any) {
      window.message.error(error.message)
    }
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
                saveLogo(savedLogo, provider.id)
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
              window.message.error(error.message)
            }
          }}>
          <MenuItem ref={uploadRef}>{t('settings.general.image_upload')}</MenuItem>
        </Upload>
      ),
      onClick: () => {
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
              <ProviderLogo>
                <ProviderAvatar pid={provider?.id} name={name} src={logo} size={60} style={{ fontSize: 32 }} />
              </ProviderLogo>
            </Popover>
          </Dropdown>
        </VStack>
      </Center>

      <Form layout="vertical" style={{ gap: 8 }}>
        <Form.Item label={t('settings.provider.add.name.label')} style={{ marginBottom: 8 }}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value.trim())}
            placeholder={t('settings.provider.add.name.placeholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                onOk()
              }
            }}
            maxLength={32}
          />
        </Form.Item>
        <Form.Item label={t('settings.provider.add.type')} style={{ marginBottom: 0 }}>
          <Select
            value={type}
            onChange={setType}
            options={[
              { label: 'OpenAI', value: 'openai' },
              { label: 'OpenAI-Response', value: 'openai-response' },
              { label: 'Gemini', value: 'gemini' },
              { label: 'Anthropic', value: 'anthropic' },
              { label: 'Azure OpenAI', value: 'azure-openai' }
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

const MenuItem = styled.div`
  width: 100%;
  text-align: center;
`

export default class AddProviderPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('AddProviderPopup')
  }
  static show(provider?: Provider) {
    return new Promise<{
      name: string
      type: ProviderType
      logo?: string
      logoFile?: File
    }>((resolve) => {
      TopView.show(
        <PopupContainer
          provider={provider}
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

const ProviderLogo = styled.div`
  cursor: pointer;
  object-fit: contain;
  border-radius: 12px;
  transition: opacity 0.3s ease;
  background-color: var(--color-background-soft);
  border: 0.5px solid var(--color-border);
  &:hover {
    opacity: 0.8;
  }
`
