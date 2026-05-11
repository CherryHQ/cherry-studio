import {
  Button,
  CodeEditor,
  type CodeEditorHandles,
  Dialog,
  DialogContent,
  DialogTitle,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  SegmentedControl,
  Tooltip
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { CopyIcon, FilePngIcon } from '@renderer/components/Icons'
import { isMac } from '@renderer/config/constant'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { extractHtmlTitle, getFileNameFromHtmlTitle } from '@renderer/utils/formats'
import { captureScrollableIframeAsBlob, captureScrollableIframeAsDataURL } from '@renderer/utils/image'
import { Camera, Check, Code, Eye, Maximize2, Minimize2, SaveIcon, SquareSplitHorizontal, X } from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface CodePanelProps {
  codeEditorRef: React.RefObject<CodeEditorHandles | null>
  html: string
  onSave?: (html: string) => void
  saved: boolean
  onClickSave: () => void
  saveLabel: string
}

const CodePanel = memo<CodePanelProps>(({ codeEditorRef, html, onSave, saved, onClickSave, saveLabel }) => {
  return (
    <div className="relative grid h-full w-full grid-rows-[minmax(0,1fr)] overflow-hidden">
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
      <div className="absolute right-4 bottom-4 z-10 flex flex-col items-center gap-1">
        <Tooltip content={saveLabel}>
          <Button
            size="icon"
            className="border-none shadow-[0_6px_16px_0_rgba(0,0,0,0.08),0_3px_6px_-4px_rgba(0,0,0,0.12),0_9px_28px_8px_rgba(0,0,0,0.05)]"
            onClick={onClickSave}>
            {saved ? <Check size={16} className="text-success" /> : <SaveIcon size={16} className="custom-lucide" />}
          </Button>
        </Tooltip>
      </div>
    </div>
  )
})

interface PreviewPanelProps {
  previewFrameRef: React.RefObject<HTMLIFrameElement | null>
  html: string
  previewTitle: string
  emptyText: string
}

const PreviewPanel = memo<PreviewPanelProps>(({ previewFrameRef, html, previewTitle, emptyText }) => {
  return (
    <div className="h-full w-full overflow-hidden bg-background">
      {html.trim() ? (
        <iframe
          ref={previewFrameRef}
          srcDoc={html}
          title={previewTitle}
          sandbox="allow-scripts allow-same-origin allow-forms"
          className="h-full w-full border-0 bg-background"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground text-sm">
          <p>{emptyText}</p>
        </div>
      )}
    </div>
  )
})

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
  const [isFullscreen, setIsFullscreen] = useState(true)
  const [saved, setSaved] = useTemporaryValue(false, 2000)
  const [splitSizes, setSplitSizes] = useState<[number, number]>([50, 50])
  const [captureOpen, setCaptureOpen] = useState(false)
  const codeEditorRef = useRef<CodeEditorHandles>(null)
  const previewFrameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!open || !isFullscreen) return

    const body = document.body
    const originalOverflow = body.style.overflow
    body.style.overflow = 'hidden'

    return () => {
      body.style.overflow = originalOverflow
    }
  }, [isFullscreen, open])

  const handleSave = useCallback(() => {
    codeEditorRef.current?.save?.()
    setSaved(true)
  }, [setSaved])

  const handleCapture = useCallback(
    async (to: 'file' | 'clipboard') => {
      const title = extractHtmlTitle(html)
      const fileName = getFileNameFromHtmlTitle(title) || 'html-artifact'

      if (to === 'file') {
        const dataUrl = await captureScrollableIframeAsDataURL(previewFrameRef)
        if (dataUrl) {
          void window.api.file.saveImage(fileName, dataUrl)
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

      setCaptureOpen(false)
    },
    [html, t]
  )

  const renderCodePanel = () => (
    <CodePanel
      codeEditorRef={codeEditorRef}
      html={html}
      onSave={onSave}
      saved={saved}
      onClickSave={handleSave}
      saveLabel={t('code_block.edit.save.label')}
    />
  )

  const renderPreviewPanel = () => (
    <PreviewPanel
      previewFrameRef={previewFrameRef}
      html={html}
      previewTitle={t('common.html_preview')}
      emptyText={t('html_artifacts.empty_preview', 'No content to preview')}
    />
  )

  const renderContent = () => {
    if (viewMode === 'code') {
      return (
        <>
          {renderCodePanel()}
          <div className="hidden">{renderPreviewPanel()}</div>
        </>
      )
    }

    if (viewMode === 'preview') {
      return renderPreviewPanel()
    }

    return (
      <ResizablePanelGroup
        direction="horizontal"
        onLayoutChanged={(layout) => {
          const codeSize = layout.code
          const previewSize = layout.preview
          if (typeof codeSize === 'number' && typeof previewSize === 'number') {
            setSplitSizes([codeSize, previewSize])
          }
        }}>
        <ResizablePanel id="code" defaultSize={splitSizes[0]} minSize={25}>
          {renderCodePanel()}
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel id="preview" defaultSize={splitSizes[1]} minSize={25}>
          {renderPreviewPanel()}
        </ResizablePanel>
      </ResizablePanelGroup>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose()
        }
      }}>
      <DialogContent
        showCloseButton={false}
        overlayClassName={isFullscreen ? 'hidden' : 'bg-black/35 backdrop-blur-[2px]'}
        onPointerDownOutside={(event) => event.preventDefault()}
        className={cn(
          'grid gap-0 overflow-hidden p-0',
          isFullscreen
            ? '!top-0 !left-0 !translate-x-0 !translate-y-0 z-[10000] h-screen w-screen max-w-none rounded-none border-0 shadow-none sm:max-w-none'
            : 'h-[80vh] w-[90vw] max-w-[1400px] sm:max-w-[1400px]'
        )}>
        <div className="grid h-full min-h-0 grid-rows-[45px_minmax(0,1fr)]">
          <header
            className={cn(
              'relative flex items-center justify-between gap-4 border-border border-b bg-background px-2.5',
              isFullscreen && '[-webkit-app-region:drag]'
            )}
            onDoubleClick={() => setIsFullscreen(!isFullscreen)}>
            <div className={cn('min-w-0 flex-1', isFullscreen && isMac ? 'pl-[65px]' : 'pl-3')}>
              <DialogTitle className="max-w-[45vw] truncate font-bold text-base text-foreground">{title}</DialogTitle>
            </div>

            <div className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 [-webkit-app-region:no-drag]">
              <SegmentedControl<ViewMode>
                size="sm"
                value={viewMode}
                onValueChange={setViewMode}
                aria-label={t('html_artifacts.view_mode')}
                options={[
                  {
                    value: 'split',
                    label: (
                      <>
                        <SquareSplitHorizontal className="size-3.5" />
                        {t('html_artifacts.split')}
                      </>
                    )
                  },
                  {
                    value: 'code',
                    label: (
                      <>
                        <Code className="size-3.5" />
                        {t('html_artifacts.code')}
                      </>
                    )
                  },
                  {
                    value: 'preview',
                    label: (
                      <>
                        <Eye className="size-3.5" />
                        {t('html_artifacts.preview')}
                      </>
                    )
                  }
                ]}
              />
            </div>

            <div
              className="flex flex-1 items-center justify-end gap-2 pr-3 [-webkit-app-region:no-drag]"
              onDoubleClick={(event) => event.stopPropagation()}>
              <Popover open={captureOpen} onOpenChange={setCaptureOpen}>
                <Tooltip content={t('html_artifacts.capture.label')}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <Camera size={16} />
                    </Button>
                  </PopoverTrigger>
                </Tooltip>
                <PopoverContent align="end" className="w-56 p-1.5">
                  <MenuList>
                    <MenuItem
                      label={t('html_artifacts.capture.to_file')}
                      icon={<FilePngIcon size={14} className="lucide-custom" />}
                      onClick={() => void handleCapture('file')}
                    />
                    <MenuItem
                      label={t('html_artifacts.capture.to_clipboard')}
                      icon={<CopyIcon size={14} className="lucide-custom" />}
                      onClick={() => void handleCapture('clipboard')}
                    />
                  </MenuList>
                </PopoverContent>
              </Popover>
              <Button onClick={() => setIsFullscreen(!isFullscreen)} variant="ghost" size="icon">
                {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </Button>
              <Button onClick={onClose} variant="ghost" size="icon">
                <X size={16} />
              </Button>
            </div>
          </header>

          <div className="min-h-0 overflow-hidden bg-background">{renderContent()}</div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default HtmlArtifactsPopup
