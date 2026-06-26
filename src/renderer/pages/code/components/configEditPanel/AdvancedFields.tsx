import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import type { AdvancedFieldDef } from './advancedFieldDefs'
import { FormField } from './PanelPrimitives'

export const AdvancedField: FC<{
  field: AdvancedFieldDef
  value: string | undefined
  onChange: (v: string) => void
}> = ({ field, value, onChange }) => {
  const { t } = useTranslation()

  if (field.type === 'select') {
    return (
      <FormField label={t(field.labelKey)}>
        <Select value={value ?? ''} onValueChange={(v) => onChange(v === '__clear__' ? '' : v)}>
          <SelectTrigger className="h-9 w-full">
            <SelectValue placeholder={t('code.adv.select_placeholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__clear__">{t('code.adv.select_placeholder')}</SelectItem>
            {field.options?.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
    )
  }

  return (
    <FormField label={t(field.labelKey)}>
      <Input
        type={field.type === 'number' ? 'number' : 'text'}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        min={field.min}
        max={field.max}
        className="font-mono"
      />
    </FormField>
  )
}

export const BooleanPill: FC<{ field: AdvancedFieldDef; value: boolean; onChange: (v: boolean) => void }> = ({
  field,
  value,
  onChange
}) => {
  const { t } = useTranslation()

  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border py-1 pr-2.5 pl-2 text-[11px] transition-colors',
        value
          ? 'border-foreground/25 bg-foreground/6 text-foreground'
          : 'border-border/50 text-muted-foreground/60 hover:border-border hover:text-foreground'
      )}>
      <span className={cn('size-1.5 shrink-0 rounded-full', value ? 'bg-success' : 'bg-muted-foreground/30')} />
      {t(field.labelKey)}
    </button>
  )
}
