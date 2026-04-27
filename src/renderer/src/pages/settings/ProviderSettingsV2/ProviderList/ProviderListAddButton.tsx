import { providerListClasses } from '@renderer/pages/settings/ProviderSettingsV2/components/ProviderSettingsPrimitives'
import { PlusIcon } from 'lucide-react'

interface ProviderListAddButtonProps {
  label: string
  disabled: boolean
  onAdd: () => void
}

export default function ProviderListAddButton({ label, disabled, onAdd }: ProviderListAddButtonProps) {
  return (
    <div className={providerListClasses.addWrap}>
      <button type="button" onClick={onAdd} disabled={disabled} className={providerListClasses.addButton}>
        <PlusIcon size={9} />
        <span>{label}</span>
      </button>
    </div>
  )
}
