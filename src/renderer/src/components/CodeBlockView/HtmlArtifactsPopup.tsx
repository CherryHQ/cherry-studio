import CodeEditor, { CodeEditorHandles } from '@renderer/components/CodeEditor'
import { CopyIcon, FilePngIcon } from '@renderer/components/Icons'
import { isMac } from '@renderer/config/constant'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { classNames } from '@renderer/utils'
import { extractHtmlTitle, getFileNameFromHtmlTitle } from '@renderer/utils/formats'
import { captureScrollableIframeAsBlob, captureScrollableIframeAsDataURL } from '@renderer/utils/image'
import { Button, Dropdown, Modal, Splitter, Tooltip, Typography } from 'antd'
import { Camera, Check, Code, Eye, Maximize2, Minimize2, SaveIcon, SquareSplitHorizontal, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface HtmlArtifactsPopupProps {
  open: boolean
  title: string
  html: string
  onSave?: (html: string) => void
  onClose: () => void
}

type ViewMode = 'split' | 'code' | 'preview'

const HtmlArtifactsPopup: React.FC<HtmlArtifactsPopupProps> = ({ open, title, html, onSave, onClose }) => {
  const { t } = useTranslation()
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [saved, setSaved] = useTemporaryValue(false, 2000)
  const codeEditorRef = useRef<CodeEditorHandles>(null)
  const previewFrameRef = useRef<HTMLIFrameElement>(null)

  // Prevent body scroll when fullscreen
  useEffect(() => {
    if (!open || !isFullscreen) return

    const body = document.body
    const originalOverflow = body.style.overflow
    body.style.overflow = 'hidden'

    return () => {
      body.style.overflow = originalOverflow
    }
  }, [isFullscreen, open])

  const handleSave = () => {
    codeEditorRef.current?.save?.()
    setSaved(true)
  }

  const handleCapture = useCallback(
    async (to: 'file' | 'clipboard') => {
      const title = extractHtmlTitle(html)
      const fileName = getFileNameFromHtmlTitle(title) || 'html-artifact'

      if (to === 'file') {
        const dataUrl = await captureScrollableIframeAsDataURL(previewFrameRef)
        if (dataUrl) {
          window.api.file.saveImage(fileName, dataUrl)
        }
      }
      if (to === 'clipboard') {
        await captureScrollableIframeAsBlob(previewFrameRef, async (blob) => {
          if (blob) {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
            window.toast.success(t('message.copy.success'))
          }
        })
      }
    },
    [html, t]
  )

  const renderHeader = () => (
    <ModalHeader onDoubleClick={() => setIsFullscreen(!isFullscreen)} className={classNames({ drag: isFullscreen })}>
      <HeaderLeft $isFullscreen={isFullscreen}>
        <TitleText ellipsis={{ tooltip: true }}>{title}</TitleText>
      </HeaderLeft>

      <HeaderCenter>
        <ViewControls onDoubleClick={(e) => e.stopPropagation()}>
          <ViewButton
            size="small"
            type={viewMode === 'split' ? 'primary' : 'default'}
            icon={<SquareSplitHorizontal size={14} />}
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
            icon={<Eye size={14} />}
            onClick={() => setViewMode('preview')}>
            {t('html_artifacts.preview')}
          </ViewButton>
        </ViewControls>
      </HeaderCenter>

      <HeaderRight onDoubleClick={(e) => e.stopPropagation()}>
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              {
                label: t('html_artifacts.capture.to_file'),
                key: 'capture_to_file',
                icon: <FilePngIcon size={14} className="lucide-custom" />,
                onClick: () => handleCapture('file')
              },
              {
                label: t('html_artifacts.capture.to_clipboard'),
                key: 'capture_to_clipboard',
                icon: <CopyIcon size={14} className="lucide-custom" />,
                onClick: () => handleCapture('clipboard')
              }
            ]
          }}>
          <Tooltip title={t('html_artifacts.capture.label')} mouseLeaveDelay={0}>
            <Button type="text" icon={<Camera size={16} />} className="nodrag" />
          </Tooltip>
        </Dropdown>
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

  const renderContent = () => {
    const codePanel = (
      <CodeSection>
        <CodeEditor
          ref={codeEditorRef}
          value={html}
          language="html"
          editable={true}
          onSave={onSave}
          height="100%"
          expanded={false}
          wrapped
          style={{ minHeight: 0 }}
          options={{
            stream: true, // FIXME: 避免多余空行
            lineNumbers: true,
            keymap: true
          }}
        />
        <ToolbarWrapper>
          <Tooltip title={t('code_block.edit.save.label')} mouseLeaveDelay={0}>
            <ToolbarButton
              shape="circle"
              size="large"
              icon={
                saved ? (
                  <Check size={16} color="var(--color-status-success)" />
                ) : (
                  <SaveIcon size={16} className="custom-lucide" />
                )
              }
              onClick={handleSave}
            />
          </Tooltip>
        </ToolbarWrapper>
      </CodeSection>
    )

    const previewPanel = (
      <PreviewSection>
        {html.trim() ? (
          <PreviewFrame
            ref={previewFrameRef}
            key={html} // Force recreate iframe when preview content changes
            srcDoc={html}
            title="HTML Preview"
            sandbox="allow-scripts allow-same-origin allow-forms"
          />
        ) : (
          <EmptyPreview>
            <p>{t('html_artifacts.empty_preview', 'No content to preview')}</p>
          </EmptyPreview>
        )}
      </PreviewSection>
    )

    switch (viewMode) {
      case 'split':
        return (
          <Splitter>
            <Splitter.Panel defaultSize="50%" min="25%">
              {codePanel}
            </Splitter.Panel>
            <Splitter.Panel defaultSize="50%" min="25%">
              {previewPanel}
            </Splitter.Panel>
          </Splitter>
        )
      case 'code':
        return codePanel
      case 'preview':
        return previewPanel
      default:
        return null
    }
  }

  return (
    <StyledModal
      $isFullscreen={isFullscreen}
      title={renderHeader()}
      open={open}
      afterClose={onClose}
      centered={!isFullscreen}
      destroyOnHidden
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
      <Container>{renderContent()}</Container>
    </StyledModal>
  )
}

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

  ::-webkit-scrollbar {
    width: 8px;
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

const HeaderRight = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-right: 12px;
`

const TitleText = styled(Typography.Text)`
  font-size: 16px;
  font-weight: bold;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  width: 50%;
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
  overflow: hidden;

  .ant-splitter {
    width: 100%;
    height: 100%;
    border: none;

    .ant-splitter-pane {
      overflow: hidden;
    }
  }
`

const CodeSection = styled.div`
  height: 100%;
  width: 100%;
  overflow: hidden;
  position: relative;
  display: grid;
  grid-template-rows: 1fr auto;
`

const PreviewSection = styled.div`
  height: 100%;
  width: 100%;
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

const ToolbarWrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  position: absolute;
  gap: 4px;
  right: 1rem;
  bottom: 1rem;
  z-index: 1;
`

const ToolbarButton = styled(Button)`
  border: none;
  box-shadow:
    0 6px 16px 0 rgba(0, 0, 0, 0.08),
    0 3px 6px -4px rgba(0, 0, 0, 0.12),
    0 9px 28px 8px rgba(0, 0, 0, 0.05);
`

export default HtmlArtifactsPopup
