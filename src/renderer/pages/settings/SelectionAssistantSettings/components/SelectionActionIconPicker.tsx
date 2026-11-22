import { ChevronDown, Dices } from 'lucide-react'
import { lazy, Suspense, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Popover, PopoverContent, PopoverTrigger, Tooltip, usePortalContainer } from '@cherrystudio/ui'
import SelectionActionIcon from '@renderer/components/selection/SelectionActionIcon'

const SelectionActionIconGrid = lazy(() => import('./SelectionActionIconGrid'))

interface SelectionActionIconPickerProps {
  value: string
  onChange: (icon: string) => void
  /** Reports a dice roll that is still loading, resolving to the rolled icon or null if superseded. */
  onRoll?: (roll: Promise<string | null>) => void
}

const SelectionActionIconPicker = ({ value, onChange, onRoll }: SelectionActionIconPickerProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const portalContainer = usePortalContainer()
  // Any newer choice invalidates a dice roll that is still loading the icon list.
  const choiceRef = useRef(0)
  const selectIcon = (icon: string) => {
    choiceRef.current += 1
    onChange(icon)
    setOpen(false)
  }
  const rollIcon = async (choice: number): Promise<string | null> => {
    const { iconNames } = await import('lucide-react/dynamic')
    if (choice !== choiceRef.current) return null
    const icon = iconNames[Math.floor(Math.random() * iconNames.length)]
    selectIcon(icon)
    return icon
  }
  const selectRandomIcon = () => {
    const roll = rollIcon(++choiceRef.current)
    onRoll?.(roll)
    return roll
  }

  return (
    <div className="flex w-full gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="min-w-0 flex-1 justify-start gap-2">
            {value ? (
              <>
                <SelectionActionIcon name={value} size={16} />
                <span className="truncate">{value}</span>
              </>
            ) : (
              <span className="truncate text-muted-foreground">
                {t('selection.settings.user_modal.icon.placeholder')}
              </span>
            )}
            <ChevronDown size={14} className="ml-auto shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" collisionBoundary={portalContainer} className="w-80 p-2">
          <Button variant="ghost" className="mb-2 w-full justify-start" onClick={() => selectIcon('')}>
            {t('selection.settings.user_modal.icon.default')}
          </Button>
          {open && (
            <Suspense fallback={<div aria-busy="true" className="h-64" />}>
              <SelectionActionIconGrid value={value} onSelect={selectIcon} />
            </Suspense>
          )}
        </PopoverContent>
      </Popover>
      <Tooltip content={t('selection.settings.user_modal.icon.random')}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('selection.settings.user_modal.icon.random')}
          onClick={selectRandomIcon}>
          <Dices size={14} />
        </Button>
      </Tooltip>
    </div>
  )
}

export default SelectionActionIconPicker
