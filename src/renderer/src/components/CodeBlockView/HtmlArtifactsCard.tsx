import { CodeOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { useTheme } from '@renderer/context/ThemeProvider'
import { ThemeMode } from '@renderer/types'
import { extractHtmlTitle, getFileNameFromHtmlTitle } from '@renderer/utils/formats'
import { Button } from 'antd'
import { Code, DownloadIcon, Globe, LinkIcon, Sparkles } from 'lucide-react'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipLoader } from 'react-spinners'
import styled, { keyframes } from 'styled-components'

import HtmlArtifactsPopup from './HtmlArtifactsPopup'

const logger = loggerService.withContext('HtmlArtifactsCard')

interface Props {
  html: string
  onSave?: (html: string) => void
  isStreaming?: boolean
}

const getTerminalStyles = (theme: ThemeMode) => ({
  background: theme === 'dark' ? '#1e1e1e' : '#f0f0f0',
  color: theme === 'dark' ? '#cccccc' : '#333333',
  promptColor: theme === 'dark' ? '#00ff00' : '#007700'
})

const HtmlArtifactsCard: FC<Props> = ({ html, onSave, isStreaming = false }) => {
  const { t } = useTranslation()
  const title = extractHtmlTitle(html) || 'HTML Artifacts'
  const [isPopupOpen, setIsPopupOpen] = useState(false)
  const { theme } = useTheme()

  const htmlContent = html || ''
  const hasContent = htmlContent.trim().length > 0

  const handleOpenExternal = async () => {
    const path = await window.api.file.createTempFile('artifacts-preview.html')
    await window.api.file.write(path, htmlContent)
    const filePath = `file://${path}`

    if (window.api.shell?.openExternal) {
      window.api.shell.openExternal(filePath)
    } else {
      logger.error(t('chat.artifacts.preview.openExternal.error.content'))
    }
  }

  const handleDownload = async () => {
    const fileName = `${getFileNameFromHtmlTitle(title) || 'html-artifact'}.html`
    await window.api.file.save(fileName, htmlContent)
    window.toast.success(t('message.download.success'))
  }

  return (
    <>
      <Container $isStreaming={isStreaming}>
        <Header>
          <IconWrapper $isStreaming={isStreaming}>
            {isStreaming ? <Sparkles size={20} color="white" /> : <Globe size={20} color="white" />}
          </IconWrapper>
          <TitleSection>
            <Title>{title}</Title>
            <TypeBadge>
              <Code size={12} />
              <span>HTML</span>
            </TypeBadge>
          </TitleSection>
        </Header>
        <Content>
          {isStreaming && !hasContent ? (
            <GeneratingContainer>
              <ClipLoader size={20} color="var(--color-primary)" />
              <GeneratingText>{t('html_artifacts.generating', 'Generating content...')}</GeneratingText>
            </GeneratingContainer>
          ) : isStreaming && hasContent ? (
            <>
              <TerminalPreview $theme={theme}>
                <TerminalContent $theme={theme}>
                  <TerminalLine>
                    <TerminalPrompt $theme={theme}>$</TerminalPrompt>
                    <TerminalCodeLine $theme={theme}>
                      {htmlContent.trim().split('\n').slice(-3).join('\n')}
                      <TerminalCursor $theme={theme} />
                    </TerminalCodeLine>
                  </TerminalLine>
                </TerminalContent>
              </TerminalPreview>
              <ButtonContainer>
                <Button icon={<CodeOutlined />} onClick={() => setIsPopupOpen(true)} type="primary">
                  {t('chat.artifacts.button.preview')}
                </Button>
              </ButtonContainer>
            </>
          ) : (
            <ButtonContainer>
              <Button icon={<CodeOutlined />} onClick={() => setIsPopupOpen(true)} type="text" disabled={!hasContent}>
                {t('chat.artifacts.button.preview')}
              </Button>
              <Button icon={<LinkIcon size={14} />} onClick={handleOpenExternal} type="text" disabled={!hasContent}>
                {t('chat.artifacts.button.openExternal')}
              </Button>
              <Button icon={<DownloadIcon size={14} />} onClick={handleDownload} type="text" disabled={!hasContent}>
                {t('code_block.download.label')}
              </Button>
            </ButtonContainer>
          )}
        </Content>
      </Container>

      <HtmlArtifactsPopup
        open={isPopupOpen}
        title={title}
        html={htmlContent}
        onSave={onSave}
        onClose={() => setIsPopupOpen(false)}
      />
    </>
  )
}

const Container = styled.div<{ $isStreaming: boolean }>`
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  margin: 10px 0;
  margin-top: 0;
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

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 24px 16px;
  background: var(--color-background-soft);
  border-bottom: 1px solid var(--color-border);
  border-radius: 8px 8px 0 0;
`

const IconWrapper = styled.div<{ $isStreaming: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  background: ${(props) =>
    props.$isStreaming
      ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
      : 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)'};
  border-radius: 12px;
  color: white;
  box-shadow: ${(props) =>
    props.$isStreaming ? '0 4px 6px -1px rgba(245, 158, 11, 0.3)' : '0 4px 6px -1px rgba(59, 130, 246, 0.3)'};
  transition: background 0.3s ease;
`

const TitleSection = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const Title = styled.span`
  font-size: 14px;
  font-weight: bold;
  color: var(--color-text-1);
  line-height: 1.4;
  font-family: 'Ubuntu';
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
`

const TypeBadge = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  background: var(--color-background-mute);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 10px;
  font-weight: 500;
  color: var(--color-text-secondary);
  width: fit-content;
`

const Content = styled.div`
  padding: 0;
  background: var(--color-background);
`

const ButtonContainer = styled.div`
  margin: 10px 16px !important;
  display: flex;
  flex-direction: row;
`

const TerminalPreview = styled.div<{ $theme: ThemeMode }>`
  margin: 16px;
  background: ${(props) => getTerminalStyles(props.$theme).background};
  border-radius: 8px;
  overflow: hidden;
  font-family: var(--code-font-family);
`

const TerminalContent = styled.div<{ $theme: ThemeMode }>`
  padding: 12px;
  background: ${(props) => getTerminalStyles(props.$theme).background};
  color: ${(props) => getTerminalStyles(props.$theme).color};
  font-size: 13px;
  line-height: 1.4;
  min-height: 80px;
`

const TerminalLine = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
`

const TerminalCodeLine = styled.span<{ $theme: ThemeMode }>`
  flex: 1;
  white-space: pre-wrap;
  word-break: break-word;
  color: ${(props) => getTerminalStyles(props.$theme).color};
  background-color: transparent !important;
`

const TerminalPrompt = styled.span<{ $theme: ThemeMode }>`
  color: ${(props) => getTerminalStyles(props.$theme).promptColor};
  font-weight: bold;
  flex-shrink: 0;
`

const blinkAnimation = keyframes`
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
`

const TerminalCursor = styled.span<{ $theme: ThemeMode }>`
  display: inline-block;
  width: 2px;
  height: 16px;
  background: ${(props) => getTerminalStyles(props.$theme).promptColor};
  animation: ${blinkAnimation} 1s infinite;
  margin-left: 2px;
`

export default HtmlArtifactsCard
