import { type Spec } from '@json-render/core'
import { ActionProvider, Renderer, StateProvider, ValidationProvider, VisibilityProvider } from '@json-render/react'
import { loggerService } from '@logger'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'

import { registry } from './registry'

const logger = loggerService.withContext('JsonRenderPreview')

interface Props {
  spec: Spec
  loading?: boolean
}

const JsonRenderPreview: FC<Props> = ({ spec, loading }) => {
  const handleNavigate = useCallback((path: string) => {
    // Only allow opening external URLs
    if (path.startsWith('http://') || path.startsWith('https://')) {
      window.api.shell.openExternal(path)
    } else {
      logger.warn('Blocked non-http navigation', { path })
    }
  }, [])

  const actionHandlers = useMemo(
    () => ({
      submit: async (params: Record<string, unknown>) => {
        logger.info('Form submitted', { params })
        window.toast.success('Form submitted')
      },
      copy: async (params: Record<string, unknown>) => {
        const text = String(params.text || params.value || '')
        await navigator.clipboard.writeText(text)
        window.toast.success('Copied to clipboard')
      }
    }),
    []
  )

  return (
    <StateProvider initialState={{}}>
      <ActionProvider handlers={actionHandlers} navigate={handleNavigate}>
        <VisibilityProvider>
          <ValidationProvider>
            <Renderer spec={spec} registry={registry} loading={loading} />
          </ValidationProvider>
        </VisibilityProvider>
      </ActionProvider>
    </StateProvider>
  )
}

export default JsonRenderPreview
