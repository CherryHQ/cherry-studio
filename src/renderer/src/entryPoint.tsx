import './assets/styles/index.scss'
import '@ant-design/v5-patch-for-react-19'

import { loggerService } from '@logger'
import { createRoot } from 'react-dom/client'

import App from './App'
import { globalErrorHandler } from './utils/errorHandler'
import { errorTestUtils } from './utils/errorTestUtils'

// Initialize logger service with window source
// Determine window type based on current URL or context
const getWindowType = (): string => {
  const url = window.location.href
  if (url.includes('mini')) return 'mini'
  if (url.includes('selection')) return 'selection'
  return 'main'
}

const windowType = getWindowType()
loggerService.initWindowSource(windowType)

const logger = loggerService.withContext('entryPoint')

// Initialize global error handler
try {
  globalErrorHandler.init()
  logger.info(`Application initializing for window: ${windowType}`)
} catch (error) {
  // Even if error handler setup fails, we should continue
  console.error('Failed to initialize global error handler:', error)
  logger.error('Failed to initialize global error handler', error as Error)
}

// Initialize error test utilities in development mode
if (window.electron?.process?.env?.NODE_ENV === 'development') {
  try {
    errorTestUtils.initDevCommands()
    logger.info('Error test utilities initialized for development')
  } catch (error) {
    console.error('Failed to initialize error test utilities:', error)
    logger.error('Failed to initialize error test utilities', error as Error)
  }
}

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<App />)

// Log successful initialization
logger.info(`Application started successfully for window: ${windowType}`)
