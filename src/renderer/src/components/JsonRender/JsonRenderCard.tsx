import { useTheme } from '@renderer/context/ThemeProvider'
import type { FC } from 'react'
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipLoader } from 'react-spinners'
import styled from 'styled-components'

import { useJsonRenderSpec } from './hooks/useJsonRenderSpec'

const JsonRenderPreview = lazy(() => import('./JsonRenderPreview'))

interface Props {
  spec: string
  onSave?: (spec: string) => void
  isStreaming?: boolean
}

const JsonRenderCard: FC<Props> = ({ spec: rawSpec = '', isStreaming = false }) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { spec, error } = useJsonRenderSpec(rawSpec, isStreaming)

  const hasContent = rawSpec.trim().length > 0

  if (isStreaming && !hasContent) {
    return (
      <LoadingContainer>
        <ClipLoader size={16} color="var(--color-primary)" />
      </LoadingContainer>
    )
  }

  if (error && !isStreaming) {
    return (
      <ErrorContainer $theme={theme}>
        <ErrorText>{t('json_render.error.parse', 'Failed to parse UI specification')}</ErrorText>
        <ErrorDetail>{error}</ErrorDetail>
      </ErrorContainer>
    )
  }

  if (spec) {
    return (
      <Suspense
        fallback={
          <LoadingContainer>
            <ClipLoader size={16} color="var(--color-primary)" />
          </LoadingContainer>
        }>
        <JsonRenderPreview spec={spec} loading={isStreaming} />
      </Suspense>
    )
  }

  return (
    <LoadingContainer>
      <ClipLoader size={16} color="var(--color-primary)" />
    </LoadingContainer>
  )
}

const LoadingContainer = styled.div`
  display: flex;
  justify-content: center;
  padding: 12px;
`

const ErrorContainer = styled.div<{ $theme: string }>`
  padding: 12px;
  background: ${(props) => (props.$theme === 'dark' ? '#2d1b1b' : '#fef2f2')};
  border: 1px solid ${(props) => (props.$theme === 'dark' ? '#5c2828' : '#fecaca')};
  border-radius: 8px;
`

const ErrorText = styled.div`
  font-size: 13px;
  font-weight: 500;
  color: var(--color-error, #ef4444);
  margin-bottom: 4px;
`

const ErrorDetail = styled.div`
  font-size: 12px;
  color: var(--color-text-secondary);
  font-family: var(--code-font-family);
`

export default JsonRenderCard
