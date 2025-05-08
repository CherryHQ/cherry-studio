import { PlusOutlined, UploadOutlined } from '@ant-design/icons'
import MinAppIcon from '@renderer/components/Icons/MinAppIcon'
import { loadCustomMiniApp, ORIGIN_DEFAULT_MIN_APPS, updateDefaultMinApps } from '@renderer/config/minapps'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { MinAppType } from '@renderer/types'
import type { MenuProps } from 'antd'
import { Button, Dropdown, Form, Input, message, Modal, Radio, Upload } from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  app: MinAppType
  onClick?: () => void
  size?: number
  isLast?: boolean
}

const App: FC<Props> = ({ app, onClick, size = 60, isLast }) => {
  const { openMinappKeepAlive } = useMinappPopup()
  const { t } = useTranslation()
  const { minapps, pinned, disabled, updateMinapps, updateDisabledMinapps, updatePinnedMinapps } = useMinapps()
  const isPinned = pinned.some((p) => p.id === app.id)
  const isVisible = minapps.some((m) => m.id === app.id)
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [form] = Form.useForm()
  const [logoType, setLogoType] = useState<'url' | 'file'>('url')
  const [fileList, setFileList] = useState<UploadFile[]>([])

  const handleClick = () => {
    if (isLast) {
      setIsModalVisible(true)
      return
    }
    openMinappKeepAlive(app)
    onClick?.()
  }

  const handleAddCustomApp = async (values: any) => {
    try {
      const content = await window.api.file.read('customMiniAPP')
      const customApps = JSON.parse(content)

      // Check for duplicate ID
      if (customApps.some((app: MinAppType) => app.id === values.id)) {
        message.error(t('settings.miniapps.custom.duplicate_ids', { ids: values.id }))
        return
      }
      if (ORIGIN_DEFAULT_MIN_APPS.some((app: MinAppType) => app.id === values.id)) {
        message.error(t('settings.miniapps.custom.conflicting_ids', { ids: values.id }))
        return
      }

      const newApp = {
        id: values.id,
        name: values.name,
        url: values.url,
        logo: form.getFieldValue('logo') || '',
        type: 'Custom',
        addTime: new Date().toISOString()
      }
      customApps.push(newApp)
      await window.api.file.writeWithId('customMiniAPP', JSON.stringify(customApps, null, 2))
      message.success(t('settings.miniapps.custom.save_success'))
      setIsModalVisible(false)
      form.resetFields()
      setFileList([])
      // 重新加载应用列表
      const reloadedApps = [...ORIGIN_DEFAULT_MIN_APPS, ...(await loadCustomMiniApp())]
      updateDefaultMinApps(reloadedApps)
      updateMinapps(reloadedApps)
    } catch (error) {
      message.error(t('settings.miniapps.custom.save_error'))
      console.error('Failed to save custom mini app:', error)
    }
  }

  const handleLogoTypeChange = (e: any) => {
    setLogoType(e.target.value)
    form.setFieldValue('logo', '')
    setFileList([])
  }

  const handleFileChange = async (info: any) => {
    console.log(info)
    const file = info.fileList[info.fileList.length - 1]?.originFileObj
    console.log(file)
    setFileList(info.fileList.slice(-1))

    if (file) {
      try {
        const reader = new FileReader()
        reader.onload = (event) => {
          const base64Data = event.target?.result
          if (typeof base64Data === 'string') {
            message.success(t('settings.miniapps.custom.logo_upload_success'))
            form.setFieldValue('logo', base64Data)
          }
        }
        reader.readAsDataURL(file)
      } catch (error) {
        console.error('Failed to read file:', error)
        message.error(t('settings.miniapps.custom.logo_upload_error'))
      }
    }
  }

  const menuItems: MenuProps['items'] = isLast
    ? []
    : [
        {
          key: 'togglePin',
          label: isPinned ? t('minapp.sidebar.remove.title') : t('minapp.sidebar.add.title'),
          onClick: () => {
            const newPinned = isPinned ? pinned.filter((item) => item.id !== app.id) : [...(pinned || []), app]
            updatePinnedMinapps(newPinned)
          }
        },
        {
          key: 'hide',
          label: t('minapp.sidebar.hide.title'),
          onClick: () => {
            const newMinapps = minapps.filter((item) => item.id !== app.id)
            updateMinapps(newMinapps)
            const newDisabled = [...(disabled || []), app]
            updateDisabledMinapps(newDisabled)
            const newPinned = pinned.filter((item) => item.id !== app.id)
            updatePinnedMinapps(newPinned)
          }
        },
        ...(app.type === 'Custom'
          ? [
              {
                key: 'removeCustom',
                label: t('minapp.sidebar.remove_custom.title'),
                danger: true,
                onClick: async () => {
                  try {
                    const content = await window.api.file.read('customMiniAPP')
                    const customApps = JSON.parse(content)
                    const updatedApps = customApps.filter((customApp: MinAppType) => customApp.id !== app.id)
                    await window.api.file.writeWithId('customMiniAPP', JSON.stringify(updatedApps, null, 2))
                    message.success(t('settings.miniapps.custom.remove_success'))
                    const reloadedApps = [...ORIGIN_DEFAULT_MIN_APPS, ...(await loadCustomMiniApp())]
                    updateDefaultMinApps(reloadedApps)
                    updateMinapps(reloadedApps)
                  } catch (error) {
                    message.error(t('settings.miniapps.custom.remove_error'))
                    console.error('Failed to remove custom mini app:', error)
                  }
                }
              }
            ]
          : [])
      ]

  if (!isVisible && !isLast) return null

  return (
    <>
      <Dropdown menu={{ items: menuItems }} trigger={['contextMenu']}>
        <Container onClick={handleClick}>
          {isLast ? (
            <AddButton>
              <PlusOutlined />
            </AddButton>
          ) : (
            <MinAppIcon size={size} app={app} />
          )}
          <AppTitle>{isLast ? t('settings.miniapps.custom.title') : app.name}</AppTitle>
        </Container>
      </Dropdown>
      <Modal
        title={t('settings.miniapps.custom.edit_title')}
        open={isModalVisible}
        onCancel={() => {
          setIsModalVisible(false)
          setFileList([])
        }}
        footer={null}>
        <Form form={form} onFinish={handleAddCustomApp} layout="vertical">
          <Form.Item
            name="id"
            label={t('settings.miniapps.custom.id')}
            rules={[{ required: true, message: t('settings.miniapps.custom.id_error') }]}>
            <Input placeholder={t('settings.miniapps.custom.id_placeholder')} />
          </Form.Item>
          <Form.Item
            name="name"
            label={t('settings.miniapps.custom.name')}
            rules={[{ required: true, message: t('settings.miniapps.custom.name_error') }]}>
            <Input placeholder={t('settings.miniapps.custom.name_placeholder')} />
          </Form.Item>
          <Form.Item
            name="url"
            label={t('settings.miniapps.custom.url')}
            rules={[{ required: true, message: t('settings.miniapps.custom.url_error') }]}>
            <Input placeholder={t('settings.miniapps.custom.url_placeholder')} />
          </Form.Item>
          <Form.Item label={t('settings.miniapps.custom.logo')}>
            <Radio.Group value={logoType} onChange={handleLogoTypeChange}>
              <Radio value="url">{t('settings.miniapps.custom.logo_url')}</Radio>
              <Radio value="file">{t('settings.miniapps.custom.logo_file')}</Radio>
            </Radio.Group>
          </Form.Item>
          {logoType === 'url' ? (
            <Form.Item name="logo" label={t('settings.miniapps.custom.logo_url_label')}>
              <Input placeholder={t('settings.miniapps.custom.logo_url_placeholder')} />
            </Form.Item>
          ) : (
            <Form.Item label={t('settings.miniapps.custom.logo_upload_label')}>
              <Upload
                accept="image/*"
                maxCount={1}
                fileList={fileList}
                onChange={handleFileChange}
                beforeUpload={() => false}>
                <Button icon={<UploadOutlined />}>{t('settings.miniapps.custom.logo_upload_button')}</Button>
              </Upload>
            </Form.Item>
          )}
          <Form.Item>
            <Button type="primary" htmlType="submit">
              {t('settings.miniapps.custom.save')}
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  overflow: hidden;
`

const AppTitle = styled.div`
  font-size: 12px;
  margin-top: 5px;
  color: var(--color-text-soft);
  text-align: center;
  user-select: none;
  white-space: nowrap;
`

const AddButton = styled.div`
  width: 60px;
  height: 60px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-background-soft);
  border: 1px dashed var(--color-border);
  color: var(--color-text-soft);
  font-size: 24px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: var(--color-background);
    border-color: var(--color-primary);
    color: var(--color-primary);
  }
`

export default App
