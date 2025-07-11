import CodeEditor from '@renderer/components/CodeEditor'
import { isMac } from '@renderer/config/constant'
import { classNames } from '@renderer/utils'
import { Button, Modal } from 'antd'
import { Code, Maximize2, Minimize2, Monitor, MonitorSpeaker, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface HtmlArtifactsPopupProps {
  open: boolean
  title: string
  html: string
  onClose: () => void
}

type ViewMode = 'split' | 'code' | 'preview'

// 视图模式配置
const VIEW_MODE_CONFIG = {
  split: {
    key: 'split' as const,
    icon: MonitorSpeaker,
    i18nKey: 'html_artifacts.split'
  },
  code: {
    key: 'code' as const,
    icon: Code,
    i18nKey: 'html_artifacts.code'
  },
  preview: {
    key: 'preview' as const,
    icon: Monitor,
    i18nKey: 'html_artifacts.preview'
  }
} as const

// 抽取头部组件
interface ModalHeaderProps {
  title: string
  isFullscreen: boolean
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  onToggleFullscreen: () => void
  onCancel: () => void
}

const ModalHeaderComponent: React.FC<ModalHeaderProps> = ({
  title,
  isFullscreen,
  viewMode,
  onViewModeChange,
  onToggleFullscreen,
  onCancel
}) => {
  const { t } = useTranslation()

  const viewButtons = useMemo(() => {
    return Object.values(VIEW_MODE_CONFIG).map(({ key, icon: Icon, i18nKey }) => (
      <ViewButton
        key={key}
        size="small"
        type={viewMode === key ? 'primary' : 'default'}
        icon={<Icon size={14} />}
        onClick={() => onViewModeChange(key)}>
        {t(i18nKey)}
      </ViewButton>
    ))
  }, [viewMode, onViewModeChange, t])

  return (
    <ModalHeader onDoubleClick={onToggleFullscreen} className={classNames({ drag: isFullscreen })}>
      <HeaderLeft $isFullscreen={isFullscreen}>
        <TitleText>{title}</TitleText>
      </HeaderLeft>
      <HeaderCenter>
        <ViewControls>{viewButtons}</ViewControls>
      </HeaderCenter>
      <HeaderRight>
        <Button
          onClick={onToggleFullscreen}
          type="text"
          icon={isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          className="nodrag"
        />
        <Button onClick={onCancel} type="text" icon={<X size={16} />} className="nodrag" />
      </HeaderRight>
    </ModalHeader>
  )
}

// 抽取代码编辑器组件
interface CodeSectionProps {
  html: string
  visible: boolean
  onCodeChange: (code: string) => void
}

const CodeSectionComponent: React.FC<CodeSectionProps> = ({ html, visible, onCodeChange }) => {
  if (!visible) return null

  return (
    <CodeSection $visible={visible}>
      <CodeEditorWrapper>
        <CodeEditor
          value={html}
          language="html"
          editable={true}
          onSave={onCodeChange}
          style={{ height: '100%' }}
          options={{
            stream: false,
            collapsible: false
          }}
        />
      </CodeEditorWrapper>
    </CodeSection>
  )
}

// 抽取预览组件
interface PreviewSectionProps {
  html: string
  visible: boolean
}

const PreviewSectionComponent: React.FC<PreviewSectionProps> = ({ html, visible }) => {
  const htmlContent = html || ''
  const [debouncedHtml, setDebouncedHtml] = useState(htmlContent)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const latestHtmlRef = useRef(htmlContent)
  const currentRenderedHtmlRef = useRef(htmlContent)
  const { t } = useTranslation()

  // 更新最新的HTML内容引用
  useEffect(() => {
    latestHtmlRef.current = htmlContent
  }, [htmlContent])

  // 固定频率渲染 HTML 内容，每2秒钟检查并更新一次
  useEffect(() => {
    // 立即设置初始内容
    setDebouncedHtml(htmlContent)
    currentRenderedHtmlRef.current = htmlContent

    // 设置定时器，每2秒检查一次内容是否有变化
    intervalRef.current = setInterval(() => {
      if (latestHtmlRef.current !== currentRenderedHtmlRef.current) {
        setDebouncedHtml(latestHtmlRef.current)
        currentRenderedHtmlRef.current = latestHtmlRef.current
      }
    }, 2000) // 2秒固定频率

    // 清理函数
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, []) // 只在组件挂载时执行一次

  if (!visible) return null
  const isHtmlEmpty = !debouncedHtml.trim()

  return (
    <PreviewSection $visible={visible}>
      {isHtmlEmpty ? (
        <EmptyPreview>
          <p>{t('html_artifacts.empty_preview', 'No content to preview')}</p>
        </EmptyPreview>
      ) : (
        <PreviewFrame
          key={debouncedHtml} // 强制重新创建iframe当内容变化时
          srcDoc={debouncedHtml}
          title="HTML Preview"
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      )}
    </PreviewSection>
  )
}

// 主弹窗组件
const HtmlArtifactsPopup: React.FC<HtmlArtifactsPopupProps> = ({ open, title, html, onClose }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [currentHtml, setCurrentHtml] = useState(html)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // 当外部html更新时，同步更新内部状态
  useEffect(() => {
    setCurrentHtml(html)
  }, [html])

  // 计算视图可见性
  const viewVisibility = useMemo(
    () => ({
      code: viewMode === 'split' || viewMode === 'code',
      preview: viewMode === 'split' || viewMode === 'preview'
    }),
    [viewMode]
  )

  // 计算Modal属性
  const modalProps = useMemo(
    () => ({
      width: isFullscreen ? '100vw' : '90vw',
      height: isFullscreen ? '100vh' : 'auto',
      style: { maxWidth: isFullscreen ? '100vw' : '1400px' }
    }),
    [isFullscreen]
  )

  const handleOk = useCallback(() => {
    onClose()
  }, [onClose])

  const handleCancel = useCallback(() => {
    onClose()
  }, [onClose])

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  const handleCodeChange = useCallback((newCode: string) => {
    setCurrentHtml(newCode)
  }, [])

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev)
  }, [])

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode)
  }, [])

  return (
    <StyledModal
      $isFullscreen={isFullscreen}
      title={
        <ModalHeaderComponent
          title={title}
          isFullscreen={isFullscreen}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          onToggleFullscreen={toggleFullscreen}
          onCancel={handleCancel}
        />
      }
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      afterClose={handleClose}
      centered
      destroyOnClose
      {...modalProps}
      footer={null}
      closable={false}>
      <Container>
        <CodeSectionComponent html={currentHtml} visible={viewVisibility.code} onCodeChange={handleCodeChange} />
        <PreviewSectionComponent html={currentHtml} visible={viewVisibility.preview} />
      </Container>
    </StyledModal>
  )
}

// 样式组件保持不变
const commonModalBodyStyles = `
  padding: 0 !important;
  display: flex !important;
  flex-direction: column !important;
`

const StyledModal = styled(Modal)<{ $isFullscreen?: boolean }>`
  ${(props) =>
    props.$isFullscreen
      ? `
    .ant-modal-wrap {
      padding: 0 !important;
    }

    .ant-modal {
      margin: 0 !important;
      padding: 0 !important;
      max-width: none !important;
    }

    .ant-modal-body {
      height: calc(100vh - 45px) !important;
      ${commonModalBodyStyles}
      max-height: initial !important;
    }
  `
      : `
    .ant-modal-body {
      height: 80vh !important;
      ${commonModalBodyStyles}
      min-height: 600px !important;
    }
  `}

  .ant-modal-body {
    ${commonModalBodyStyles}
  }

  .ant-modal-content {
    border-radius: ${(props) => (props.$isFullscreen ? '0px' : '12px')};
    overflow: hidden;
    height: ${(props) => (props.$isFullscreen ? '100vh' : 'auto')};
    padding: 0 !important;
  }

  .ant-modal-header {
    padding: 10px 12px !important;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-background);
    border-radius: 0 !important;
    margin-bottom: 0 !important;
  }

  .ant-modal-title {
    margin: 0;
    width: 100%;
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
  display: flex;
  justify-content: center;
  z-index: 1;
`

const HeaderRight = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
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
  width: auto;
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

const CodeSection = styled.div<{ $visible: boolean }>`
  flex: ${(props) => (props.$visible ? '1' : '0')};
  min-width: ${(props) => (props.$visible ? '300px' : '0')};
  border-right: ${(props) => (props.$visible ? '1px solid var(--color-border)' : 'none')};
  overflow: hidden;
  display: ${(props) => (props.$visible ? 'flex' : 'none')};
  flex-direction: column;
`

const CodeEditorWrapper = styled.div`
  flex: 1;
  height: 100%;
  overflow: hidden;

  .monaco-editor {
    height: 100% !important;
  }

  .cm-editor {
    height: 100% !important;
  }

  .cm-scroller {
    height: 100% !important;
  }
`

const PreviewSection = styled.div<{ $visible: boolean }>`
  flex: ${(props) => (props.$visible ? '1' : '0')};
  min-width: ${(props) => (props.$visible ? '300px' : '0')};
  background: white;
  overflow: hidden;
  display: ${(props) => (props.$visible ? 'block' : 'none')};
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
