import CodeEditor from '@renderer/components/CodeEditor'
import { isLinux, isMac, isWin } from '@renderer/config/constant'
import { classNames } from '@renderer/utils'
import { Button, Modal } from 'antd'
import { Code, Maximize2, Minimize2, Monitor, MonitorSpeaker, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface HtmlArtifactsPopupProps {
  open: boolean
  title: string
  html: string
  onClose: () => void
}

type ViewMode = 'split' | 'code' | 'preview'

const HtmlArtifactsPopup: React.FC<HtmlArtifactsPopupProps> = ({ open, title, html, onClose }) => {
  const { t } = useTranslation()
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [currentHtml, setCurrentHtml] = useState(html)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // 预览刷新相关状态
  const [previewHtml, setPreviewHtml] = useState(html)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const latestHtmlRef = useRef(html)

  // 当外部html更新时，同步更新内部状态
  useEffect(() => {
    setCurrentHtml(html)
    latestHtmlRef.current = html
  }, [html])

  // 当内部编辑的html更新时，更新引用
  useEffect(() => {
    latestHtmlRef.current = currentHtml
  }, [currentHtml])

  // 2秒定时检查并刷新预览（仅在内容变化时）
  useEffect(() => {
    if (!open) return

    // 立即设置初始预览内容
    setPreviewHtml(currentHtml)

    // 设置定时器，每2秒检查一次内容是否有变化
    intervalRef.current = setInterval(() => {
      if (latestHtmlRef.current !== previewHtml) {
        setPreviewHtml(latestHtmlRef.current)
      }
    }, 2000)

    // 清理函数
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [currentHtml, open, previewHtml])

  // 全屏时防止 body 滚动
  useEffect(() => {
    if (!open || !isFullscreen) return

    const body = document.body
    const originalOverflow = body.style.overflow
    body.style.overflow = 'hidden'

    return () => {
      body.style.overflow = originalOverflow
    }
  }, [isFullscreen, open])

  const showCode = viewMode === 'split' || viewMode === 'code'
  const showPreview = viewMode === 'split' || viewMode === 'preview'

  const renderHeader = () => (
    <ModalHeader onDoubleClick={() => setIsFullscreen(!isFullscreen)} className={classNames({ drag: isFullscreen })}>
      <HeaderLeft $isFullscreen={isFullscreen}>
        <TitleText>{title}</TitleText>
      </HeaderLeft>

      <HeaderCenter>
        <ViewControls>
          <ViewButton
            size="small"
            type={viewMode === 'split' ? 'primary' : 'default'}
            icon={<MonitorSpeaker size={14} />}
            onClick={() => setViewMode('split')}>
            {t('html_artifacts.split')}
          </ViewButton>
          <ViewButton
            size="small"
            type={viewMode === 'code' ? 'primary' : 'default'}
            icon={<Code size={14} />}
            onClick={() => setViewMode('code')}>
            {t('html_artifacts.code')}
          </ViewButton>
          <ViewButton
            size="small"
            type={viewMode === 'preview' ? 'primary' : 'default'}
            icon={<Monitor size={14} />}
            onClick={() => setViewMode('preview')}>
            {t('html_artifacts.preview')}
          </ViewButton>
        </ViewControls>
      </HeaderCenter>

      <HeaderRight $isFullscreen={isFullscreen}>
        <Button
          onClick={() => setIsFullscreen(!isFullscreen)}
          type="text"
          icon={isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          className="nodrag"
        />
        <Button onClick={onClose} type="text" icon={<X size={16} />} className="nodrag" />
      </HeaderRight>
    </ModalHeader>
  )

  return (
    <StyledModal
      $isFullscreen={isFullscreen}
      title={renderHeader()}
      open={open}
      afterClose={onClose}
      centered={!isFullscreen}
      destroyOnClose
      mask={!isFullscreen}
      maskClosable={false}
      width={isFullscreen ? '100vw' : '90vw'}
      style={{
        maxWidth: isFullscreen ? '100vw' : '1400px',
        height: isFullscreen ? '100vh' : 'auto'
      }}
      zIndex={isFullscreen ? 10000 : 1000}
      footer={null}
      closable={false}>
      <Container>
        {showCode && (
          <CodeSection>
            <CodeEditor
              value={currentHtml}
              language="html"
              editable={true}
              onSave={setCurrentHtml}
              style={{ height: '100%' }}
              expanded
              unwrapped={false}
              options={{
                stream: false
              }}
            />
          </CodeSection>
        )}

        {showPreview && (
          <PreviewSection>
            {previewHtml.trim() ? (
              <PreviewFrame
                key={previewHtml} // 强制重新创建iframe当预览内容变化时
                srcDoc={previewHtml}
                title="HTML Preview"
                sandbox="allow-scripts allow-same-origin allow-forms"
              />
            ) : (
              <EmptyPreview>
                <p>{t('html_artifacts.empty_preview', 'No content to preview')}</p>
              </EmptyPreview>
            )}
          </PreviewSection>
        )}
      </Container>
    </StyledModal>
  )
}

// 简化的样式组件
const StyledModal = styled(Modal)<{ $isFullscreen?: boolean }>`
  ${(props) =>
    props.$isFullscreen
      ? `
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    z-index: 10000 !important;

    .ant-modal-wrap {
      padding: 0 !important;
      position: fixed !important;
      inset: 0 !important;
    }

    .ant-modal {
      margin: 0 !important;
      padding: 0 !important;
      max-width: none !important;
      position: fixed !important;
      inset: 0 !important;
    }

    .ant-modal-body {
      height: calc(100vh - 45px) !important;
    }
  `
      : `
    .ant-modal-body {
      height: 80vh !important;
      min-height: 600px !important;
    }
  `}

  .ant-modal-body {
    padding: 0 !important;
    display: flex !important;
    flex-direction: column !important;
    max-height: initial !important;
  }

  .ant-modal-content {
    border-radius: ${(props) => (props.$isFullscreen ? '0px' : '12px')};
    overflow: hidden;
    height: ${(props) => (props.$isFullscreen ? '100vh' : 'auto')};
    padding: 0 !important;
  }

  .ant-modal-header {
    padding: 10px !important;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-background);
    margin-bottom: 0 !important;
    border-radius: 0 !important;
  }
`

const ModalHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  position: relative;
`

const HeaderLeft = styled.div<{ $isFullscreen?: boolean }>`
  flex: 1;
  min-width: 0;
  padding-left: ${(props) => (props.$isFullscreen && isMac ? '65px' : '12px')};
`

const HeaderCenter = styled.div`
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
`

const HeaderRight = styled.div<{ $isFullscreen?: boolean }>`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-right: ${({ $isFullscreen }) => ($isFullscreen ? (isWin ? '136px' : isLinux ? '120px' : '12px') : '12px')};
`

const TitleText = styled.span`
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const ViewControls = styled.div`
  display: flex;
  gap: 8px;
  padding: 4px;
  background: var(--color-background-mute);
  border-radius: 8px;
  border: 1px solid var(--color-border);
  -webkit-app-region: no-drag;
`

const ViewButton = styled(Button)`
  border: none;
  box-shadow: none;

  &.ant-btn-primary {
    background: var(--color-primary);
    color: white;
  }

  &.ant-btn-default {
    background: transparent;
    color: var(--color-text-secondary);

    &:hover {
      background: var(--color-background);
      color: var(--color-text);
    }
  }
`

const Container = styled.div`
  display: flex;
  height: 100%;
  width: 100%;
  flex: 1;
  background: var(--color-background);
`

const CodeSection = styled.div`
  flex: 1;
  min-width: 300px;
  border-right: 1px solid var(--color-border);
  overflow: hidden;

  .monaco-editor,
  .cm-editor,
  .cm-scroller {
    height: 100% !important;
  }
`

const PreviewSection = styled.div`
  flex: 1;
  min-width: 300px;
  background: white;
  overflow: hidden;
`

const PreviewFrame = styled.iframe`
  width: 100%;
  height: 100%;
  border: none;
  background: white;
`

const EmptyPreview = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  background: var(--color-background-soft);
  color: var(--color-text-secondary);
  font-size: 14px;
`

export default HtmlArtifactsPopup
