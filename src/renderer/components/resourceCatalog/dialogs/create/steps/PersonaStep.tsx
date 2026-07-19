import { Button, FormField, FormItem, Input, Popover, PopoverContent, PopoverTrigger, Scrollbar } from '@cherrystudio/ui'
import { PromptEditorField } from '@renderer/components/PromptEditorField'
import {
  EDIT_DIALOG_PROMPT_MAX_HEIGHT,
  EDIT_DIALOG_PROMPT_MIN_HEIGHT,
  FieldLabelWithHelp,
  PromptVariablesPopover
} from '@renderer/components/resourceCatalog/dialogs/components/EditDialogShared'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { cn } from '@renderer/utils/style'
import { BookOpen, FileText, Search } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import type { ResourceCreateWizardFormValues } from '../types'

type PersonaStepProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  portalContainer: HTMLElement | null
}

/**
 * Step 2 (shared by assistant + agent): the system prompt / persona. Includes an
 * "Import Prompt" toolbar to pull from the assistant library or a local file.
 */
export function PersonaStep({ form, portalContainer }: PersonaStepProps) {
  const { t } = useTranslation()
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [librarySearch, setLibrarySearch] = useState('')
  const { data } = useQuery('/assistants', { query: { limit: 500 }, enabled: libraryOpen })

  const assistants = useMemo(() => {
    if (!data?.items) return []
    const keyword = librarySearch.trim().toLowerCase()
    return data.items
      .filter((a) => {
        if (!keyword) return true
        return (
          a.name.toLowerCase().includes(keyword) ||
          (a.description ?? '').toLowerCase().includes(keyword)
        )
      })
      .slice(0, 50)
  }, [data, librarySearch])

  const handleImportFromLibrary = useCallback(
    (prompt: string) => {
      form.setValue('prompt', prompt, { shouldDirty: true, shouldTouch: true })
      setLibraryOpen(false)
      setLibrarySearch('')
    },
    [form]
  )

  const handleImportFromFile = useCallback(async () => {
    const selected = await window.api.file.select({
      filters: [
        { name: 'Text Files', extensions: ['md', 'txt'] }
      ],
      properties: ['openFile']
    })
    if (!selected || selected.length === 0) return

    try {
      const content = await window.api.file.readExternal(selected[0].path)
      form.setValue('prompt', content, { shouldDirty: true, shouldTouch: true })
    } catch {
      // Silently fail — file read error is not critical
    }
  }, [form])

  return (
    <FormField
      control={form.control}
      name="prompt"
      render={({ field }) => (
        <FormItem className="flex h-full min-h-0 flex-col">
          <div className="mb-2 flex items-center justify-between gap-2">
            <FieldLabelWithHelp
              label={t('library.config.prompt.label')}
              formLabel={false}
              helpTrigger={<PromptVariablesPopover portalContainer={portalContainer} />}
            />
            <div className="flex shrink-0 items-center gap-1">
              <Popover open={libraryOpen} onOpenChange={setLibraryOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
                    <BookOpen className="size-3.5" />
                    {t('library.config.prompt.importLibrary')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 p-0">
                  <div className="border-border-muted border-b px-3 py-2">
                    <div className="relative">
                      <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder={t('library.config.prompt.searchAssistants')}
                        className="h-7 pl-7 text-xs"
                        value={librarySearch}
                        onChange={(e) => setLibrarySearch(e.target.value)}
                        autoFocus
                      />
                    </div>
                  </div>
                  <Scrollbar className="max-h-52">
                    {assistants.length === 0 ? (
                      <div className="px-3 py-6 text-center text-muted-foreground text-xs">
                        {librarySearch
                          ? t('library.config.prompt.noResults')
                          : t('library.config.prompt.emptyLibrary')}
                      </div>
                    ) : (
                      assistants.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => handleImportFromLibrary(a.prompt ?? '')}
                          className={cn(
                            'flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-accent',
                            (!a.prompt || a.prompt.trim().length === 0) && 'opacity-40'
                          )}>
                          <span className="mt-0.5 shrink-0 text-sm">{a.emoji ?? '🤖'}</span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs">{a.name}</div>
                            {a.description ? (
                              <div className="line-clamp-1 text-muted-foreground text-[11px]">
                                {a.description}
                              </div>
                            ) : null}
                            {!a.prompt || a.prompt.trim().length === 0 ? (
                              <div className="text-muted-foreground text-[10px]">
                                {t('library.config.prompt.noPrompt')}
                              </div>
                            ) : (
                              <div className="line-clamp-1 text-muted-foreground text-[11px] font-mono">
                                {a.prompt.slice(0, 80)}{a.prompt.length > 80 ? '...' : ''}
                              </div>
                            )}
                          </div>
                        </button>
                      ))
                    )}
                  </Scrollbar>
                </PopoverContent>
              </Popover>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={handleImportFromFile}>
                <FileText className="size-3.5" />
                {t('library.config.prompt.importFile')}
              </Button>
            </div>
          </div>

          <PromptEditorField
            label={null}
            value={field.value}
            onChange={field.onChange}
            placeholder={t('library.config.prompt.placeholder')}
            minHeight={EDIT_DIALOG_PROMPT_MIN_HEIGHT}
            maxHeight={EDIT_DIALOG_PROMPT_MAX_HEIGHT}
            autoFocus
            fill
          />
        </FormItem>
      )}
    />
  )
}
