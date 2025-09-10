import { loggerService } from '@logger'
import { Center, VStack } from '@renderer/components/Layout'
import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import ProviderLogoPicker from '@renderer/components/ProviderLogoPicker'
import { TopView } from '@renderer/components/TopView'
import { PROVIDER_LOGO_MAP } from '@renderer/config/providers'
import ImageStorage from '@renderer/services/ImageStorage'
import { Provider, ProviderType } from '@renderer/types'
import { compressImage, generateColorFromChar, getForegroundColor } from '@renderer/utils'
import { Divider, Dropdown, Form, Input, Modal, Popover, Select, Upload } from 'antd'
import { ItemType } from 'antd/es/menu/interface'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('AddProviderPopup')

interface Props {
  provider?: Provider
  resolve: (result: { name: string; type: ProviderType; logo?: string; logoFile?: File }) => void
}

const PopupContainer: React.FC<Props> = ({ provider, resolve }) => {
  const [open, setOpen] = useState(true)
  const [name, setName] = useState(provider?.name || '')
  const [type, setType] = useState<ProviderType>(provider?.type || 'openai')
  const [logo, setLogo] = useState<string | null>(null)
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
