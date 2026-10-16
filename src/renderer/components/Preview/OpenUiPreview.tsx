import { Renderer, type OpenUIError } from '@openuidev/react-lang'
import { memo, useCallback, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'

import { Alert, Box } from '@cherrystudio/ui'
import { loggerService } from '@logger'

import { openUiLibrary } from './openUiLibrary'
import type { BasicPreviewProps } from './types'

const logger = loggerService.withContext('OpenUiPreview')

const OpenUiPreview = ({ children, isStreaming = false }: BasicPreviewProps) => {
  const { t } = useTranslation()
  const [hasErrors, setHasErrors] = useState(false)
  const handleError = useCallback((errors: OpenUIError[]) => {
    const failures = errors.filter((error) => error.severity !== 'warning')
    setHasErrors(failures.length > 0)
    if (failures.length) {
      logger.warn('OpenUI parsing failed', {
        errors: failures.map(({ code, component, path }) => ({ code, component, path }))
      })
    }
  }, [])
  const error = <Alert type="error" message={t('file_preview.load_error.title')} />

  return (
    <Box className="openui special-preview min-w-0 overflow-auto bg-background p-4 text-foreground">
      <ErrorBoundary
        fallback={error}
        resetKeys={[children]}
        onError={(cause) => logger.error('OpenUI rendering failed', cause)}>
        <Renderer
          response={children}
          library={openUiLibrary}
          isStreaming={isStreaming}
          onError={handleError}
          publishObservability={false}
        />
        {hasErrors && !isStreaming && error}
      </ErrorBoundary>
    </Box>
  )
}

export default memo(OpenUiPreview)
