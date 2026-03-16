import { useTheme } from '@renderer/context/ThemeProvider'
import { Button } from 'antd'
import { Code, DownloadIcon, Maximize2 } from 'lucide-react'
import type { FC } from 'react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipLoader } from 'react-spinners'
import styled from 'styled-components'

import { useJsonRenderSpec } from './hooks/useJsonRenderSpec'

const JsonRenderPreview = lazy(() => import('./JsonRenderPreview'))
const JsonRenderPopup = lazy(() => import('./JsonRenderPopup'))

interface Props {
  spec: string
  onSave?: (spec: string) => void
  isStreaming?: boolean
}

const JsonRenderCard: FC<Props> = ({ spec: rawSpec = '', onSave, isStreaming = false }) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [isPopupOpen, setIsPopupOpen] = useState(false)
  const { spec, error } = useJsonRenderSpec(rawSpec, isStreaming)

  const hasContent = rawSpec.trim().length > 0

  const handleDownload = async () => {
    const fileName = 'json-render-spec.json'
    const content = spec ? JSON.stringify(spec, null, 2) : rawSpec
    await window.api.file.save(fileName, content)
    window.toast.success(t('message.download.success'))
  }

  return (
    <>
      <Container>
        {isStreaming && !hasContent ? (
          <GeneratingContainer>
            <ClipLoader size={20} color="var(--color-primary)" />
            <GeneratingText>{t('json_render.generating', 'Generating interactive UI...')}</GeneratingText>
          </GeneratingContainer>
        ) : error && !isStreaming ? (
          <ErrorContainer $theme={theme}>
            <ErrorText>{t('json_render.error.parse', 'Failed to parse UI specification')}</ErrorText>
            <ErrorDetail>{error}</ErrorDetail>
          </ErrorContainer>
        ) : spec ? (
          <Suspense fallback={<LoadingFallback />}>
            <JsonRenderPreview spec={spec} loading={isStreaming} />
          </Suspense>
        ) : (
          <GeneratingContainer>
            <ClipLoader size={20} color="var(--color-primary)" />
            <GeneratingText>{t('json_render.generating', 'Generating interactive UI...')}</GeneratingText>
          </GeneratingContainer>
        )}
        {!isStreaming && hasContent && (
          <FloatingToolbar>
            <Button
              icon={<Maximize2 size={14} />}
              onClick={() => setIsPopupOpen(true)}
              type="text"
              size="small"
              disabled={!spec}
            />
            <Button
              icon={<Code size={14} />}
              onClick={() => setIsPopupOpen(true)}
              type="text"
              size="small"
              disabled={!hasContent}
            />
            <Button
              icon={<DownloadIcon size={14} />}
              onClick={handleDownload}
              type="text"
              size="small"
              disabled={!hasContent}
            />
          </FloatingToolbar>
        )}
      </Container>

      {isPopupOpen && (
        <Suspense fallback={null}>
          <JsonRenderPopup
            open={isPopupOpen}
            title={t('json_render.popup.title', 'Interactive UI Preview')}
            spec={rawSpec}
            onSave={onSave}
            onClose={() => setIsPopupOpen(false)}
          />
        </Suspense>
      )}
    </>
  )
}

const LoadingFallback = () => (
  <GeneratingContainer>
    <ClipLoader size={20} color="var(--color-primary)" />
  </GeneratingContainer>
)

const Container = styled.div`
  position: relative;

  &:hover > ${() => FloatingToolbar} {
    opacity: 1;
    pointer-events: auto;
  }
`

const FloatingToolbar = styled.div`
  position: absolute;
  bottom: 8px;
  right: 8px;
  display: flex;
  gap: 2px;
  padding: 4px;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
`

const GeneratingContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  padding: 20px;
  min-height: 78px;
`

const GeneratingText = styled.div`
  font-size: 14px;
  color: var(--color-text-secondary);
`

const ErrorContainer = styled.div<{ $theme: string }>`
  padding: 16px;
  background: ${(props) => (props.$theme === 'dark' ? '#2d1b1b' : '#fef2f2')};
  border: 1px solid ${(props) => (props.$theme === 'dark' ? '#5c2828' : '#fecaca')};
  border-radius: 8px;
`

const ErrorText = styled.div`
  font-size: 14px;
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
