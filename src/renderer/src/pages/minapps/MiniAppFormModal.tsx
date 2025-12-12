import { UploadOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import type { MinAppType } from '@renderer/types'
import { Button, Form, Input, Modal, Radio, Upload } from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  visible: boolean
  mode: 'create' | 'edit'
  initialValues?: MinAppType
  onCancel: () => void
  onSubmit: (values: MinAppType) => void
}

const logger = loggerService.withContext('MiniAppFormModal')

const MiniAppFormModal: FC<Props> = ({ visible, mode, initialValues, onCancel, onSubmit }) => {
  const { t } = useTranslation()
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [logoType, setLogoType] = useState<'url' | 'file'>('url')
  const [form] = Form.useForm()

  useEffect(() => {
    if (initialValues) {
      form.setFieldsValue(initialValues)
    }
  }, [initialValues, form])

  const handleLogoTypeChange = (e: any) => {
    setLogoType(e.target.value)
    form.setFieldValue('logo', '')
    setFileList([])
  }

  const handleSubmit = async (values: any) => {
    const newApp: MinAppType = {
      id: values.id,
      name: values.name,
      url: values.url,
      logo: form.getFieldValue('logo') || '',
      type: 'Custom',
      addTime: mode === 'edit' && initialValues?.addTime ? initialValues.addTime : new Date().toISOString()
    }
    onSubmit(newApp)
    form.resetFields()
    setFileList([])
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
      <Modal
        title={t('settings.miniapps.custom.edit_title')}
        open={visible}
        onCancel={() => {
          setFileList([])
          onCancel()
        }}
        maskClosable={false}
        footer={null}
        transitionName="animation-move-down"
        centered>
        <Form form={form} onFinish={handleSubmit} layout="vertical">
          <Form.Item
            name="id"
            label={t('settings.miniapps.custom.id')}
            rules={[{ required: true, message: t('settings.miniapps.custom.id_error') }]}>
            <Input placeholder={t('settings.miniapps.custom.id_placeholder')} disabled={mode === 'edit'} />
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
              {mode === 'create' ? t('settings.miniapps.custom.save') : t('settings.miniapps.custom.edit')}
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

export default MiniAppFormModal
