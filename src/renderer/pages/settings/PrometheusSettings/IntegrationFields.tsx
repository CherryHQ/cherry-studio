import { useId, type ReactNode } from 'react'
import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@cherrystudio/ui'
import { SettingHelpText, SettingRow, SettingRowTitle } from '@renderer/components/SettingsPrimitives'

export function IntegrationField({ label, value, onChange, type = 'text', help, disabled = false }: {
  label: string; value: string; onChange: (value: string) => void; type?: 'text' | 'password' | 'number'; help?: string; disabled?: boolean
}) {
  const id = useId()
  return <div className="min-w-0 space-y-1.5">
    <label htmlFor={id} className="text-sm font-medium">{label}</label>
    <Input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}
      autoComplete={type === 'password' ? 'new-password' : 'off'} aria-describedby={help ? `${id}-help` : undefined} className="w-full" />
    {help && <SettingHelpText id={`${id}-help`}>{help}</SettingHelpText>}
  </div>
}

export function IntegrationChoice<T extends string>({ label, value, onChange, options, disabled }: {
  label: string; value: T; onChange: (value: T) => void; options: { value: T; label: string }[]; disabled?: boolean
}) {
  const id = useId()
  return <div className="min-w-0 space-y-1.5">
    <label htmlFor={id} className="text-sm font-medium">{label}</label>
    <Select value={value} onValueChange={(next) => onChange(next as T)} disabled={disabled}>
      <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
    </Select>
  </div>
}

export function IntegrationToggle({ label, checked, onChange, children }: {
  label: string; checked: boolean; onChange: (value: boolean) => void; children?: ReactNode
}) {
  const id = useId()
  return <div>
    <SettingRow className="gap-4"><SettingRowTitle><label htmlFor={id}>{label}</label></SettingRowTitle>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </SettingRow>
    {children}
  </div>
}
