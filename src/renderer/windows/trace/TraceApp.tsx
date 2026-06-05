import { usePreference } from '@data/hooks/usePreference'
import { useWindowInitData } from '@renderer/hooks/useWindowInitData'
import i18n from '@renderer/i18n'
import { defaultLanguage } from '@shared/config/constant'
import type { TraceWindowInitData } from '@shared/types/traceWindow'
import { useEffect, useState } from 'react'

import { TraceIcon } from './pages/Component'
import { TracePage } from './pages/index'

const TraceApp = () => {
  const initData = useWindowInitData<TraceWindowInitData>()
  const [language] = usePreference('app.language')
  const [traceId, setTraceId] = useState('')
  const [topicId, setTopicId] = useState('')
  const [modelName, setModelName] = useState<string | undefined>(undefined)
  const [reload, setReload] = useState(false)
  const [title, setTitle] = useState('Call Chain Window')

  useEffect(() => {
    if (!initData?.traceId || !initData?.topicId) return
    setTraceId(initData.traceId)
    setTopicId(initData.topicId)
    setModelName(initData.modelName)
    setReload((value) => !value)
  }, [initData])

  useEffect(() => {
    void i18n.changeLanguage(language || navigator.language || defaultLanguage).then(() => {
      const newTitle = initData?.title || i18n.t('trace.traceWindow')
      setTitle(newTitle)
      void window.api.trace.setTraceWindowTitle(newTitle)
    })
  }, [language, initData?.title])

  const handleFooterClick = () => {
    void window.api.shell.openExternal('https://www.aliyun.com/product/edas')
  }

  return (
    <>
      <header className="header">
        <div className="headerIcon">
          <TraceIcon color="#e74c3c" size={24} />
        </div>
        <div className="headerTitle">{title}</div>
      </header>
      <TracePage traceId={traceId} topicId={topicId} reload={reload} modelName={modelName} />
      <footer>
        <span onClick={handleFooterClick} className="footer-link">
          {i18n.t('trace.edasSupport')}
        </span>
      </footer>
    </>
  )
}

export default TraceApp
