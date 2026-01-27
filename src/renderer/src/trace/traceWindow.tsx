import i18n from '@renderer/i18n'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { TraceIcon } from './pages/Component'
import { TracePage } from './pages/index'

const App = () => {
  const [traceId, setTraceId] = useState('')
  const [topicId, setTopicId] = useState('')
  const [assistantMsgId, setAssistantMsgId] = useState('')
  const [modelName, setModelName] = useState<string | undefined>(undefined)
  const [reload, setReload] = useState(false)
  const [title, setTitle] = useState('Call Chain Window')

  useEffect(() => {
    const setTraceHandler = (_, data) => {
      if (data?.traceId && data?.topicId) {
        setTraceId(data.traceId)
        setTopicId(data.topicId)
        setAssistantMsgId(data.assistantMsgId || '')
        setModelName(data.modelName)
        setReload(!reload)
      }
    }

    const setLangHandler = (_, data) => {
      i18n.changeLanguage(data.lang)
      const newTitle = i18n.t('trace.traceWindow')
      if (newTitle !== title) {
        window.api.trace.setTraceWindowTitle(i18n.t('trace.traceWindow'))
        setTitle(newTitle)
      }
    }

    const removeTraceHandler = window.electron.ipcRenderer.once('set-trace', setTraceHandler)
    const removeLanguageHandler = window.electron.ipcRenderer.once('set-language', setLangHandler)

    return () => {
      removeTraceHandler()
      removeLanguageHandler()
    }
  }, [title, reload, modelName, traceId, topicId])

  const handleFooterClick = () => {
    window.api.shell.openExternal('https://www.aliyun.com/product/edas')
  }

  return (
    <>
      <header className="header">
        <div className="headerTitle">
          <TraceIcon color="#e74c3c" size={16} />
          <span style={{ marginLeft: '5px' }}>{title}</span>
        </div>
      </header>
      <TracePage
        traceId={traceId}
        topicId={topicId}
        reload={reload}
        modelName={modelName}
        assistantMsgId={assistantMsgId}
      />
      <footer>
        <span onClick={handleFooterClick} className="footer-link">
          {i18n.t('trace.edasSupport')}
        </span>
      </footer>
    </>
  )
}

const root = createRoot(document.getElementById('root')!)
root.render(<App />)
