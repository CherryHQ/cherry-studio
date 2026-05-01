import { PlusOutlined, UploadOutlined } from '@ant-design/icons'
import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { ORIGIN_DEFAULT_MINI_APPS } from '@shared/data/presets/mini-apps'
import { Form, Input, Modal, Radio, Upload } from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  size?: number
}

const logger = loggerService.withContext('NewAppButton')

const NewAppButton: FC<Props> = ({ size = 60 }) => {
  const { t } = useTranslation()
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [logoType, setLogoType] = useState<'url' | 'file'>('url')
  const [form] = Form.useForm()
  const { miniapps, disabled, pinned, createCustomMiniApp } = useMiniApps()

  const handleLogoTypeChange = (e: any) => {
    setLogoType(e.target.value)
    form.setFieldValue('logo', '')
    setFileList([])
  }

  const handleAddCustomApp = async (values: any) => {
    try {
      // Check for duplicate ID against builtin presets
      if (ORIGIN_DEFAULT_MINI_APPS.some((app) => app.id === values.id)) {
        window.toast.error(t('settings.miniapps.custom.conflicting_ids', { ids: values.id }))
        return
      }
      // Check for duplicate ID against existing apps in DB
      const existingAppIds = new Set([...miniapps, ...disabled, ...pinned].map((a) => a.appId))
      if (existingAppIds.has(values.id)) {
        window.toast.error(t('settings.miniapps.custom.duplicate_ids', { ids: values.id }))
        return
      }

      await createCustomMiniApp({
        appId: values.id,
        name: values.name,
        url: values.url,
        logo: form.getFieldValue('logo') || 'application',
        bordered: false,
        supportedRegions: ['CN', 'Global']
      })
      window.toast.success(t('settings.miniapps.custom.save_success'))
      setIsModalVisible(false)
      form.resetFields()
      setFileList([])
    } catch (error) {
      window.toast.error(t('settings.miniapps.custom.save_error'))
      logger.error('Failed to save custom mini app:', error as Error)
    }
  }

  const handleFileChange = async (info: any) => {
    const file = info.fileList[info.fileList.length - 1]?.originFileObj
    setFileList(info.fileList.slice(-1))

    if (file) {
      try {
        const reader = new FileReader()
        reader.onload = (event) => {
          const base64Data = event.target?.result
          if (typeof base64Data === 'string') {
            window.toast.success(t('settings.miniapps.custom.logo_upload_success'))
            form.setFieldValue('logo', base64Data)
          }
        }
        reader.readAsDataURL(file)
      } catch (error) {
        logger.error('Failed to read file:', error as Error)
        window.toast.error(t('settings.miniapps.custom.logo_upload_error'))
      }
    }
  }

  return (
    <>
      <Container onClick={() => setIsModalVisible(true)}>
        <AddButton size={size}>
          <PlusOutlined />
        </AddButton>
        <AppTitle>{t('settings.miniapps.custom.title')}</AppTitle>
      </Container>
      <Modal
        title={t('settings.miniapps.custom.edit_title')}
        open={isModalVisible}
        onCancel={() => {
          setIsModalVisible(false)
          setFileList([])
        }}
        maskClosable={false}
        footer={null}
        transitionName="animation-move-down"
        centered>
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
                <Button>
                  <UploadOutlined />
                  {t('settings.miniapps.custom.logo_upload_button')}
                </Button>
              </Upload>
            </Form.Item>
          )}
          <Form.Item>
            <Button variant="default" color="primary" type="submit">
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
  align-items: center;
  justify-content: center;
  cursor: pointer;
`

const AddButton = styled.div<{ size?: number }>`
  width: ${({ size }) => size || 60}px;
  height: ${({ size }) => size || 60}px;
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

const AppTitle = styled.div`
  font-size: 12px;
  margin-top: 5px;
  color: var(--color-text-soft);
  text-align: center;
  user-select: none;
  white-space: nowrap;
`

export default NewAppButton
