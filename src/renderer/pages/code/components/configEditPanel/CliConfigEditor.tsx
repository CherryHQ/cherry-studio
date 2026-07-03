import { Button, CodeEditor, Tabs, TabsContent, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { useCodeStyle } from '@renderer/hooks/useCodeStyle'
import type { CliConfigFileDraft } from '@renderer/pages/code/cliConfig'
import { formatCliConfigDraftFile } from '@renderer/pages/code/cliConfig'
import { cn } from '@renderer/utils/style'
import { Wand2 } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface CliConfigEditorProps {
  files: CliConfigFileDraft[]
  error?: string
  onChange: (files: CliConfigFileDraft[]) => void
}

export const CliConfigEditor: FC<CliConfigEditorProps> = ({ files, error, onChange }) => {
  const { t } = useTranslation()
  const [fontSize] = usePreference('chat.message.font_size')
  const { activeCmTheme } = useCodeStyle()
  const [activeTarget, setActiveTarget] = useState<string>(files[0]?.target ?? '')

  useEffect(() => {
    if (!files.some((file) => file.target === activeTarget)) {
      setActiveTarget(files[0]?.target ?? '')
    }
  }, [activeTarget, files])

  const activeFile = useMemo(
    () => files.find((file) => file.target === activeTarget) ?? files[0],
    [activeTarget, files]
  )

  if (!files.length) return null

  const updateFile = (target: string, content: string) => {
    onChange(files.map((file) => (file.target === target ? { ...file, content } : file)))
  }

  const handleFormat = () => {
    if (!activeFile) return
    try {
      onChange(files.map((file) => (file.target === activeFile.target ? formatCliConfigDraftFile(file) : file)))
    } catch {
      window.toast.error(t('code.cli_config.format_failed'))
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-foreground text-xs">{t('code.cli_config.title')}</div>
          <div className="truncate text-[10px] text-muted-foreground/55">{activeFile?.path}</div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1.5 px-2 text-xs"
          onClick={handleFormat}
          disabled={activeFile?.language !== 'json'}>
          <Wand2 size={12} />
          {t('code.format_json')}
        </Button>
      </div>

      {files.length > 1 ? (
        <Tabs value={activeFile?.target} onValueChange={setActiveTarget} className="min-w-0">
          <TabsList className="h-8 max-w-full overflow-x-auto rounded-md bg-muted/40 p-0.5">
            {files.map((file) => (
              <TabsTrigger key={file.target} value={file.target} className="h-7 shrink-0 px-2 text-xs">
                {file.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {files.map((file) => (
            <TabsContent key={file.target} value={file.target} className="mt-2">
              <EditorBody file={file} fontSize={fontSize} theme={activeCmTheme} onChange={updateFile} />
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        activeFile && <EditorBody file={activeFile} fontSize={fontSize} theme={activeCmTheme} onChange={updateFile} />
      )}

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-destructive text-xs">
          {error}
        </div>
      ) : (
        <div className="text-[10px] text-muted-foreground/55">{t('code.cli_config.hint')}</div>
      )}
    </div>
  )
}

const EditorBody: FC<{
  file: CliConfigFileDraft
  fontSize: number
  theme: React.ComponentProps<typeof CodeEditor>['theme']
  onChange: (target: string, content: string) => void
}> = ({ file, fontSize, theme, onChange }) => (
  <div className={cn('overflow-hidden rounded-lg border border-border/60 bg-background')}>
    <CodeEditor
      theme={theme}
      fontSize={fontSize - 1}
      value={file.content}
      language={file.language === 'dotenv' ? 'dotenv' : file.language}
      onChange={(value) => onChange(file.target, value)}
      height="260px"
      maxHeight="260px"
      expanded={false}
      wrapped
      options={{
        autocompletion: true,
        lineNumbers: true,
        foldGutter: true,
        keymap: true
      }}
    />
  </div>
)
