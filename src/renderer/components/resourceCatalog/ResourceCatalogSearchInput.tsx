import { Search, X } from 'lucide-react'
import type { ChangeEvent } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Input } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'

type ResourceCatalogSearchInputProps = {
  value: string
  onValueChange: (value: string) => void
  placeholder: string
  autoFocus?: boolean
  className?: string
}

export function ResourceCatalogSearchInput({
  value,
  onValueChange,
  placeholder,
  autoFocus,
  className
}: ResourceCatalogSearchInputProps) {
  const { t } = useTranslation()

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onValueChange(event.target.value)
    },
    [onValueChange]
  )

  const clear = useCallback(() => onValueChange(''), [onValueChange])

  return (
    <div className={cn('relative', className)}>
      <Search size={14} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-foreground-tertiary" />
      <Input
        autoFocus={autoFocus}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        className="h-8 rounded-md border-input bg-background pr-8 pl-8 text-sm placeholder:text-muted-foreground"
      />
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('common.clear')}
          onClick={clear}
          className="absolute top-1/2 right-1 size-6 -translate-y-1/2 rounded-full text-muted-foreground hover:bg-transparent hover:text-foreground">
          <X size={12} />
        </Button>
      ) : null}
    </div>
  )
}
