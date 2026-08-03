import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { ModelSelectorRow } from '@renderer/components/ModelSelector'
import Scrollbar from '@renderer/components/Scrollbar'
import { DEFAULT_SELECTOR_CONTENT_HEIGHT, SelectorShell } from '@renderer/components/SelectorShell'
import { ChevronDown, Library } from 'lucide-react'
import { useId, useState } from 'react'

const KNOWLEDGE_BASE_ROW_HEIGHT = 36
const KNOWLEDGE_BASE_LIST_PADDING = 8
const KNOWLEDGE_BASE_EMPTY_LIST_HEIGHT = 80
const KNOWLEDGE_BASE_SHELL_CHROME_HEIGHT = 40

interface KnowledgeBaseSelectorOption {
  label: string
  value: string
  disabled?: boolean
}

interface KnowledgeBaseSelectorProps {
  value?: string
  options: KnowledgeBaseSelectorOption[]
  placeholder: string
  searchPlaceholder: string
  emptyText: string
  invalid?: boolean
  'aria-label'?: string
  onChange: (value: string) => void
}

export const KnowledgeBaseSelector = ({
  value,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  invalid = false,
  'aria-label': ariaLabel,
  onChange
}: KnowledgeBaseSelectorProps) => {
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const listboxId = useId()
  const selectedOption = options.find((option) => option.value === value)
  const query = searchValue.trim().toLowerCase()
  const filteredOptions = query ? options.filter((option) => option.label.toLowerCase().includes(query)) : options
  const listHeight =
    filteredOptions.length > 0
      ? filteredOptions.length * KNOWLEDGE_BASE_ROW_HEIGHT + KNOWLEDGE_BASE_LIST_PADDING
      : KNOWLEDGE_BASE_EMPTY_LIST_HEIGHT
  const contentHeight = Math.min(DEFAULT_SELECTOR_CONTENT_HEIGHT, listHeight + KNOWLEDGE_BASE_SHELL_CHROME_HEIGHT)

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setSearchValue('')
    }
  }

  const handleSelect = (nextValue: string) => {
    onChange(nextValue)
    handleOpenChange(false)
  }

  return (
    <SelectorShell
      trigger={
        <Button
          type="button"
          variant="outline"
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          className={cn(
            'h-9 w-full min-w-0 justify-between gap-2 rounded-md px-3 font-normal text-sm shadow-none',
            'aria-expanded:border-primary aria-expanded:ring-3 aria-expanded:ring-primary/20',
            selectedOption ? 'text-foreground' : 'text-muted-foreground',
            invalid && 'aria-invalid:border-error-border aria-invalid:ring-error/20 dark:aria-invalid:ring-error/40'
          )}>
          <span className="min-w-0 truncate text-left">{selectedOption?.label ?? placeholder}</span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </Button>
      }
      open={open}
      onOpenChange={handleOpenChange}
      width="var(--radix-popover-trigger-width)"
      contentHeight={contentHeight}
      search={{
        value: searchValue,
        onChange: setSearchValue,
        placeholder: searchPlaceholder,
        ariaControls: listboxId
      }}
      data-testid="knowledge-base-selector-content">
      {({ availableListHeight }) => (
        <Scrollbar
          id={listboxId}
          role="listbox"
          tabIndex={-1}
          className="min-h-0 flex-1 px-1 py-1 outline-none"
          style={{ height: availableListHeight ?? listHeight }}>
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => {
              const selected = option.value === value

              return (
                <div key={option.value} className="py-0.5">
                  <ModelSelectorRow
                    selected={selected}
                    disabled={option.disabled}
                    showSelectedIndicator={selected}
                    leading={<Library className="size-4 shrink-0 text-muted-foreground" />}
                    onSelect={() => handleSelect(option.value)}
                    optionProps={{ 'aria-selected': selected }}>
                    <span className="truncate">{option.label}</span>
                  </ModelSelectorRow>
                </div>
              )
            })
          ) : (
            <div className="flex h-full items-center justify-center px-3 text-center text-muted-foreground text-xs">
              {emptyText}
            </div>
          )}
        </Scrollbar>
      )}
    </SelectorShell>
  )
}
