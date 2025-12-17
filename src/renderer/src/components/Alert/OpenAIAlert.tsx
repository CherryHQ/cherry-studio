import { Alert } from 'antd'
import { t } from 'i18next'
import { useEffect, useState } from 'react'

const LOCALSTORAGE_KEY = 'openai_alert_closed'

interface Props {
  message?: string
  key?: string
}

const OpenAIAlert = ({ message = t('settings.provider.openai.alert'), key = LOCALSTORAGE_KEY }: Props) => {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const closed = localStorage.getItem(key)
    setVisible(!closed)
  }, [key])

  if (!visible) return null

  return (
    <Alert
      style={{ width: '100%', marginTop: 5, marginBottom: 5 }}
      message={message}
      closable
      afterClose={() => {
        localStorage.setItem(LOCALSTORAGE_KEY, '1')
        setVisible(false)
      }}
      type="warning"
    />
  )
}

export default OpenAIAlert
