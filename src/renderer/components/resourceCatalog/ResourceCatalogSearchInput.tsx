import { Button, Input } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { Search, X } from 'lucide-react'
import type { ChangeEvent, ComponentProps } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

type ResourceCatalogSearchInputProps = {
  value: string
  onValueChange: (value: string) => void
  placeholder: string
  autoFocus?: boolean
  className?: string
} & Pick<ComponentProps<'input'>, 'aria-label' | 'aria-invalid' | 'aria-describedby'>

export function ResourceCatalogSearchInput({
  value,
  onValueChange,
  placeholder,
  autoFocus,
  className,
  ...inputProps
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
      <Search size={14} className="-translate-y-1/2 absolute top-1/2 left-2.5 text-foreground-tertiary" />
      <Input
        {...inputProps}
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
          className="-translate-y-1/2 absolute top-1/2 right-1 size-6 rounded-full text-muted-foreground hover:bg-transparent hover:text-foreground">
          <X size={12} />
        </Button>
      ) : null}
    </div>
  )
}
