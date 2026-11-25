import '@renderer/assets/styles/tailwind.css'
import '@renderer/assets/styles/font.css'
import '@renderer/assets/styles/markdown.css'
import '@cherrystudio/ui/components/composites/markdown/styles'
import './print.css'
import { createRoot } from 'react-dom/client'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { prepareWindow } from '@renderer/windows/prepareWindow'

import DocumentPrintApp from './DocumentPrintApp'

const logger = loggerService.withContext('DocumentPrint')
const reportFailure = (error: unknown) => {
  logger.error('Document print renderer failed', error as Error)
  void ipcApi
    .request('print.document.ready', {
      error: error instanceof Error ? error.message : String(error)
    })
    .catch((reportError) => logger.error('Failed to report print renderer failure', reportError as Error))
}

window.addEventListener('error', (event) => reportFailure(event.error ?? event.message))
window.addEventListener('unhandledrejection', (event) => reportFailure(event.reason))

try {
  await prepareWindow({ preference: ['app.language', 'chat.message.math.single_dollar'] })
  const root = document.getElementById('root')
  if (!root) throw new Error('Document print root is missing')
  createRoot(root, { onUncaughtError: reportFailure }).render(<DocumentPrintApp />)
} catch (error) {
  reportFailure(error)
}
