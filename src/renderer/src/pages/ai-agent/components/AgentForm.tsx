import { Button, Form, Input } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

const AgentForm: FC = () => {
  const { t } = useTranslation()

  return (
    <Form layout="vertical">
      <Form.Item label={t('ai_agent.form.name.label')}>
        <Input placeholder={t('ai_agent.form.name.placeholder')} />
      </Form.Item>
      <Form.Item label={t('ai_agent.form.description.label')}>
        <Input.TextArea rows={4} placeholder={t('ai_agent.form.description.placeholder')} />
      </Form.Item>
      <Form.Item>
        <Button type="primary">{t('common.save')}</Button>
      </Form.Item>
    </Form>
  )
}

export default AgentForm