import { TopView } from '@renderer/components/TopView'
import { Button, Flex, Form, FormProps, Input, Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ShowParams {
  title: string
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

type FieldType = {
  url: string
  name?: string
}

const PopupContainer: React.FC<Props> = ({ title, resolve }) => {
  const [open, setOpen] = useState(true)
  const [form] = Form.useForm()
  const { t } = useTranslation()

  const onOk = () => {
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  const onFinish: FormProps<FieldType>['onFinish'] = (values) => {
    const url = values.url.trim()
    const name = values.name?.trim() || url

    if (!url) {
      window.message.error(t('settings.tool.websearch.url_required'))
      return
    }

    // 验证URL格式
    try {
      new URL(url)
    } catch (e) {
      window.message.error(t('settings.tool.websearch.url_invalid'))
      return
    }

    resolve({ url, name })
  }

  return (
    <Modal
      title={title}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      maskClosable={false}
      afterClose={onClose}
      footer={null}
      transitionName="animation-move-down"
      centered>
      <Form
        form={form}
        labelCol={{ flex: '110px' }}
        labelAlign="right"
        colon={false}
        style={{ marginTop: 25 }}
        onFinish={onFinish}>
        <Form.Item name="url" label={t('settings.tool.websearch.subscribe_url')} rules={[{ required: true }]}>
          <Input
            placeholder="https://git.io/ublacklist"
            spellCheck={false}
            maxLength={500}
            onChange={(e) => {
              try {
                const url = new URL(e.target.value)
                form.setFieldValue('name', url.hostname)
              } catch (e) {
                // URL不合法，忽略
              }
            }}
          />
        </Form.Item>
        <Form.Item name="name" label={t('settings.tool.websearch.subscribe_name')}>
          <Input placeholder={t('settings.tool.websearch.subscribe_name.placeholder')} spellCheck={false} />
        </Form.Item>
        <Flex justify="end" style={{ marginBottom: 8 }}>
          <Button type="primary" htmlType="submit">
            {t('settings.tool.websearch.subscribe_add')}
          </Button>
        </Flex>
      </Form>
    </Modal>
  )
}

export default class AddSubscribePopup {
  static topviewId = 0
  static hide() {
    TopView.hide('AddSubscribePopup')
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
        'AddSubscribePopup'
      )
    })
  }
}
