import { CodeOutlined, LinkOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { ThemeMode } from '@renderer/types'
import { extractTitle } from '@renderer/utils/formats'
import { Button } from 'antd'
import { Code, Download, Globe, Sparkles } from 'lucide-react'
import { FC, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipLoader } from 'react-spinners'
import styled, { keyframes } from 'styled-components'

import HtmlArtifactsPopup from './HtmlArtifactsPopup'

interface Props {
  html: string
}

const HtmlArtifactsCard: FC<Props> = ({ html }) => {
  const { t } = useTranslation()
  const title = extractTitle(html) || 'HTML Artifacts'
  const [isPopupOpen, setIsPopupOpen] = useState(false)
  const { theme } = useTheme()

  const htmlContent = html || ''
  const hasContent = htmlContent.trim().length > 0

  // 判断是否正在流式生成的逻辑
  const isStreaming = useMemo(() => {
    if (!hasContent) return false

    const trimmedHtml = htmlContent.trim()

    // 提前检查：如果包含关键的结束标签，直接判断为完整文档
    if (/<\/html\s*>/i.test(trimmedHtml)) {
      return false
    }

    // 如果同时包含 DOCTYPE 和 </body>，通常也是完整文档
    if (/<!DOCTYPE\s+html/i.test(trimmedHtml) && /<\/body\s*>/i.test(trimmedHtml)) {
      return false
    }

    // 检查 HTML 是否看起来是完整的
    const indicators = {
      // 1. 检查常见的 HTML 结构完整性
      hasHtmlTag: /<html[^>]*>/i.test(trimmedHtml),
      hasClosingHtmlTag: /<\/html\s*>$/i.test(trimmedHtml),

      // 2. 检查 body 标签完整性
      hasBodyTag: /<body[^>]*>/i.test(trimmedHtml),
      hasClosingBodyTag: /<\/body\s*>/i.test(trimmedHtml),

      // 3. 检查是否以未闭合的标签结尾
      endsWithIncompleteTag: /<[^>]*$/.test(trimmedHtml),

      // 4. 检查是否有未配对的标签
      hasUnmatchedTags: checkUnmatchedTags(trimmedHtml),

      // 5. 检查是否以常见的"流式结束"模式结尾
      endsWithTypicalCompletion: /(<\/html>\s*|<\/body>\s*|<\/div>\s*|<\/script>\s*|<\/style>\s*)$/i.test(trimmedHtml)
    }

    // 如果有明显的未完成标志，则认为正在生成
    if (indicators.endsWithIncompleteTag || indicators.hasUnmatchedTags) {
      return true
    }

    // 如果有 HTML 结构但不完整
    if (indicators.hasHtmlTag && !indicators.hasClosingHtmlTag) {
      return true
    }

    // 如果有 body 结构但不完整
    if (indicators.hasBodyTag && !indicators.hasClosingBodyTag) {
      return true
    }

    // 对于简单的 HTML 片段，检查是否看起来是完整的
    if (!indicators.hasHtmlTag && !indicators.hasBodyTag) {
      // 如果是简单片段且没有明显的结束标志，可能还在生成
      return !indicators.endsWithTypicalCompletion && trimmedHtml.length < 500
    }

    return false
  }, [htmlContent, hasContent])

  // 检查未配对标签的辅助函数
  function checkUnmatchedTags(html: string): boolean {
    const stack: string[] = []
    const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g

    // HTML5 void 元素（自闭合元素）的完整列表
    const voidElements = [
      'area',
      'base',
      'br',
      'col',
      'embed',
      'hr',
      'img',
      'input',
      'link',
      'meta',
      'param',
      'source',
      'track',
      'wbr'
    ]

    let match

    while ((match = tagRegex.exec(html)) !== null) {
      const [fullTag, tagName] = match
      const isClosing = fullTag.startsWith('</')
      const isSelfClosing = fullTag.endsWith('/>') || voidElements.includes(tagName.toLowerCase())

      if (isSelfClosing) continue

      if (isClosing) {
        if (stack.length === 0 || stack.pop() !== tagName.toLowerCase()) {
          return true // 找到不匹配的闭合标签
        }
      } else {
        stack.push(tagName.toLowerCase())
      }
    }

    return stack.length > 0 // 还有未闭合的标签
  }

  // 获取格式化的代码预览
  function getFormattedCodePreview(html: string): string {
    const trimmed = html.trim()
    const lines = trimmed.split('\n')
    const lastFewLines = lines.slice(-3) // 显示最后3行
    return lastFewLines.join('\n')
  }

  /**
   * 在编辑器中打开
   */
  const handleOpenInEditor = () => {
    setIsPopupOpen(true)
  }

  /**
   * 关闭弹窗
   */
  const handleClosePopup = () => {
    setIsPopupOpen(false)
  }

  /**
   * 外部链接打开
   */
  const handleOpenExternal = async () => {
    const path = await window.api.file.createTempFile('artifacts-preview.html')
    await window.api.file.write(path, htmlContent)
    const filePath = `file://${path}`

    if (window.api.shell && window.api.shell.openExternal) {
      window.api.shell.openExternal(filePath)
    } else {
      console.error(t('artifacts.preview.openExternal.error.content'))
    }
  }

  /**
   * 下载到本地
   */
  const handleDownload = async () => {
    const fileName = `${title.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '-') || 'html-artifact'}.html`
    await window.api.file.save(fileName, htmlContent)
    window.message.success({ content: t('message.download.success'), key: 'download' })
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
              <GeneratingText>{t('html_artifacts.generating_content', 'Generating content...')}</GeneratingText>
            </GeneratingContainer>
          ) : isStreaming && hasContent ? (
            <>
              <TerminalPreview $theme={theme}>
                <TerminalContent $theme={theme}>
                  <TerminalLine>
                    <TerminalPrompt $theme={theme}>$</TerminalPrompt>
                    <TerminalCodeLine $theme={theme}>
                      {getFormattedCodePreview(htmlContent)}
                      <TerminalCursor $theme={theme} />
                    </TerminalCodeLine>
                  </TerminalLine>
                </TerminalContent>
              </TerminalPreview>
              <ButtonContainer>
                <Button icon={<CodeOutlined />} onClick={handleOpenInEditor} type="primary">
                  {t('chat.artifacts.button.preview')}
                </Button>
              </ButtonContainer>
            </>
          ) : (
            <ButtonContainer>
              <Button icon={<CodeOutlined />} onClick={handleOpenInEditor} type="primary" disabled={!hasContent}>
                {t('chat.artifacts.button.preview')}
              </Button>
              <Button icon={<LinkOutlined />} onClick={handleOpenExternal} disabled={!hasContent}>
                {t('chat.artifacts.button.openExternal')}
              </Button>
              <Button icon={<Download size={16} />} onClick={handleDownload} disabled={!hasContent}>
                {t('code_block.download')}
              </Button>
            </ButtonContainer>
          )}
        </Content>
      </Container>

      {/* 弹窗组件 */}
      <HtmlArtifactsPopup open={isPopupOpen} title={title} html={htmlContent} onClose={handleClosePopup} />
    </>
  )
}

const shimmer = keyframes`
  0% {
    background-position: -200px 0;
  }
  100% {
    background-position: calc(200px + 100%) 0;
  }
`

const Container = styled.div<{ $isStreaming: boolean }>`
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  margin: 10px 0;
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
  position: relative;
  border-radius: 8px 8px 0 0;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(90deg, #3b82f6, #8b5cf6, #06b6d4);
    background-size: 200% 100%;
    animation: ${shimmer} 3s ease-in-out infinite;
    border-radius: 8px 8px 0 0;
  }
`

const IconWrapper = styled.div<{ $isStreaming: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
  border-radius: 12px;
  color: white;
  box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.3);
  transition: background 0.3s ease;

  ${(props) =>
    props.$isStreaming &&
    `
    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); /* Darker orange for loading */
    box-shadow: 0 4px 6px -1px rgba(245, 158, 11, 0.3);
  `}
`

const TitleSection = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const Title = styled.h3`
  margin: 0 !important;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
  line-height: 1.4;
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
  margin: 16px !important;
  display: flex;
  flex-direction: row;
  gap: 8px;
`

const TerminalPreview = styled.div<{ $theme: ThemeMode }>`
  margin: 16px;
  background: ${(props) => (props.$theme === 'dark' ? '#1e1e1e' : '#f0f0f0')};
  border-radius: 8px;
  overflow: hidden;
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace;
`

const TerminalContent = styled.div<{ $theme: ThemeMode }>`
  padding: 12px;
  background: ${(props) => (props.$theme === 'dark' ? '#1e1e1e' : '#f0f0f0')};
  color: ${(props) => (props.$theme === 'dark' ? '#cccccc' : '#333333')};
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
  color: ${(props) => (props.$theme === 'dark' ? '#cccccc' : '#333333')};
  background-color: transparent !important;
`

const TerminalPrompt = styled.span<{ $theme: ThemeMode }>`
  color: ${(props) => (props.$theme === 'dark' ? '#00ff00' : '#007700')};
  font-weight: bold;
  flex-shrink: 0;
`

const TerminalCursor = styled.span<{ $theme: ThemeMode }>`
  display: inline-block;
  width: 2px;
  height: 16px;
  background: ${(props) => (props.$theme === 'dark' ? '#00ff00' : '#007700')};
  animation: ${keyframes`
    0%, 50% { opacity: 1; }
    51%, 100% { opacity: 0; }
  `} 1s infinite;
  margin-left: 2px;
`

export default HtmlArtifactsCard
