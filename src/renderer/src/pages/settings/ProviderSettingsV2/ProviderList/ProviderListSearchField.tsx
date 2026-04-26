import { Search } from 'lucide-react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

interface ProviderListSearchFieldProps {
  value: string
  disabled: boolean
  onValueChange: (value: string) => void
}

export default function ProviderListSearchField({ value, disabled, onValueChange }: ProviderListSearchFieldProps) {
  const { t } = useTranslation()

  return (
    <div className="px-3 pb-1.5">
      <div className="flex items-center gap-1.5 rounded-lg border border-border/20 bg-foreground/[0.03] px-2 py-[4px]">
        <Search size={9} className="shrink-0 text-foreground/50" />
        <input
          value={value}
          placeholder={t('settings.provider.search')}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onValueChange(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              onValueChange('')
            }
          }}
          disabled={disabled}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground/80 outline-none placeholder:text-foreground/40"
        />
      </div>
    </div>
  )
}
