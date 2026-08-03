import { Button, type CompoundIcon } from '@cherrystudio/ui'
import { Doc2x, Mineru, Mistral, Paddleocr } from '@cherrystudio/ui/icons'
import { cn } from '@cherrystudio/ui/lib/utils'
import { ModelSelectorRow } from '@renderer/components/ModelSelector'
import Scrollbar from '@renderer/components/Scrollbar'
import { DEFAULT_SELECTOR_CONTENT_HEIGHT, SelectorShell } from '@renderer/components/SelectorShell'
import { useListboxKeyboardNavigation } from '@renderer/components/useListboxKeyboardNavigation'
import type { KnowledgeSelectOption } from '@renderer/pages/knowledge/types'
import { ChevronDown, CircleSlash, Settings2 } from 'lucide-react'
import { useState } from 'react'

export type FileProcessorSelectorOption = KnowledgeSelectOption & {
  disabled: boolean
}

interface FileProcessorSelectorProps {
  value: string | null
  options: FileProcessorSelectorOption[]
  placeholder: string
  unavailableLabel: string
  settingsLabel: string
  'aria-label'?: string
  onChange: (value: string | null) => void
  onSettingsNavigate: () => void
}

const FILE_PROCESSOR_LOGOS: Record<string, CompoundIcon> = {
  paddleocr: Paddleocr,
  mineru: Mineru,
  doc2x: Doc2x,
  mistral: Mistral,
  'open-mineru': Mineru
}
const FILE_PROCESSOR_ROW_HEIGHT = 36
const FILE_PROCESSOR_LIST_PADDING = 8
const FILE_PROCESSOR_SHELL_CHROME_HEIGHT = 69

const FileProcessorIcon = ({ processorId }: { processorId: string }) => {
  const Logo = FILE_PROCESSOR_LOGOS[processorId]

  return (
    <span
      className="inline-flex size-4 shrink-0 items-center justify-center"
      data-testid={`processor-icon-${processorId}`}>
      <Logo.Avatar size={16} shape="rounded" />
    </span>
  )
}

export const FileProcessorSelector = ({
  value,
  options,
  placeholder,
  unavailableLabel,
  settingsLabel,
  'aria-label': ariaLabel,
  onChange,
  onSettingsNavigate
}: FileProcessorSelectorProps) => {
  const [open, setOpen] = useState(false)
  const selectedOption = options.find((option) => option.value === value)
  const listHeight = options.length * FILE_PROCESSOR_ROW_HEIGHT + FILE_PROCESSOR_LIST_PADDING
  const contentHeight = Math.min(DEFAULT_SELECTOR_CONTENT_HEIGHT, listHeight + FILE_PROCESSOR_SHELL_CHROME_HEIGHT)

  const handleSelect = (nextValue: string | null) => {
    onChange(nextValue)
    setOpen(false)
  }

  const handleSettingsNavigate = () => {
    setOpen(false)
    onSettingsNavigate()
  }

  const { activeIndex, activeOptionId, getOptionId, handleKeyDown, listboxId, listRef, setActiveIndex } =
    useListboxKeyboardNavigation({
      open,
      options,
      value,
      onSelect: (option) => handleSelect(option.value)
    })

  return (
    <SelectorShell
      trigger={
        <Button
          type="button"
          variant="outline"
          aria-label={ariaLabel}
          className={cn(
            'h-8 w-full min-w-0 justify-between gap-2 rounded-md px-3 font-normal text-sm shadow-none',
            'aria-expanded:border-primary aria-expanded:ring-3 aria-expanded:ring-primary/20',
            selectedOption ? 'text-foreground' : 'text-muted-foreground'
          )}>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {selectedOption ? <FileProcessorIcon processorId={selectedOption.value} /> : null}
            <span className="min-w-0 truncate text-left">{selectedOption?.label ?? placeholder}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </Button>
      }
      open={open}
      onOpenChange={setOpen}
      width="var(--radix-popover-trigger-width)"
      contentHeight={contentHeight}
      bottomAction={[
        {
          icon: <Settings2 className="size-3.5" />,
          label: settingsLabel,
          onClick: handleSettingsNavigate
        },
        {
          type: 'selectable',
          icon: <CircleSlash className="size-3.5" />,
          label: placeholder,
          selected: value === null,
          onClick: () => handleSelect(null)
        }
      ]}
      contentProps={{
        onKeyDown: handleKeyDown,
        onOpenAutoFocus: (event) => {
          event.preventDefault()
          listRef.current?.focus()
        }
      }}
      data-testid="file-processor-selector-content">
      {({ availableListHeight }) => (
        <Scrollbar
          id={listboxId}
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          aria-activedescendant={activeOptionId}
          tabIndex={0}
          className="min-h-0 flex-1 px-1 py-1 outline-none"
          style={{ height: availableListHeight ?? listHeight }}>
          {options.map((option, index) => {
            const selected = option.value === value
            const active = index === activeIndex

            return (
              <div
                key={option.value}
                className="py-0.5"
                data-listbox-option-index={index}
                onMouseEnter={() => {
                  if (!option.disabled) setActiveIndex(index)
                }}>
                <ModelSelectorRow
                  selected={selected}
                  focused={active}
                  disabled={option.disabled}
                  showSelectedIndicator={selected}
                  leading={<FileProcessorIcon processorId={option.value} />}
                  trailing={option.disabled ? <span className="text-[10px]">{unavailableLabel}</span> : undefined}
                  onSelect={() => handleSelect(option.value)}
                  optionProps={{
                    id: getOptionId(index),
                    'aria-selected': selected,
                    'data-active': active || undefined
                  }}>
                  <span className="truncate">{option.label}</span>
                </ModelSelectorRow>
              </div>
            )
          })}
        </Scrollbar>
      )}
    </SelectorShell>
  )
}
