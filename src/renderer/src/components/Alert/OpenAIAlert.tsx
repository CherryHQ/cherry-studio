import { Alert } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const LOCALSTORAGE_KEY = 'openai_alert_closed'

const OpenAIAlert = () => {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const closed = localStorage.getItem(LOCALSTORAGE_KEY)
    setVisible(!closed)
  }, [])

  if (!visible) return null

  return (
    <Alert
      style={{ width: '100%', marginTop: 5 }}
      message={t('settings.provider.openai.alert')}
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
