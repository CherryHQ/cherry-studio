import { Alert, Button } from '@cherrystudio/ui'
import i18n from '@renderer/i18n/resolver'
import { formatErrorDetails } from '@renderer/utils/errorDetails'
import { useEffect } from 'react'
import type { FallbackProps } from 'react-error-boundary'

/**
 * Fallback for the top-level ErrorBoundary that wraps each window's provider stack.
 *
 * It renders after a provider crashed, so no React context exists here: translations
 * must go through the global i18n singleton (never `useTranslation`), and styling can
 * only rely on the unconditional `:root` token defaults — the fallback stays in the
 * light palette because ThemeProvider never got to apply the `dark` class.
 */
export const WindowFatalFallback = ({ error }: FallbackProps) => {
  // The main window's boot spinner is normally removed by useAppInit, a leaf inside
  // the provider stack; when a provider throws it never runs, and the leftover fixed
  // full-viewport overlay would block clicks on this fallback.
  useEffect(() => {
    document.getElementById('spinner')?.remove()
  }, [])

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 p-4">
      <Alert
        type="error"
        message={i18n.t('error.boundary.default.message')}
        description={formatErrorDetails(error)}
        className="max-w-xl"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void window.api.devTools.toggle()}>
          {i18n.t('error.boundary.default.devtools')}
        </Button>
        <Button size="sm" onClick={() => void window.api.reload()}>
          {i18n.t('error.boundary.default.reload')}
        </Button>
      </div>
    </div>
  )
}
