import { SearchInput } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

import type { BaseNavigatorSearchProps } from './types'

const BaseNavigatorSearch = ({ value, onValueChange }: BaseNavigatorSearchProps) => {
  const { t } = useTranslation()

  return (
    <div className="[&_[data-slot=input-group-addon]]:px-2.5 [&_[data-slot=input-group-addon]]:text-foreground-muted [&_[data-slot=input-group-addon]_svg]:size-4 [&_[data-slot=input-group-control]]:h-8 [&_[data-slot=input-group-control]]:py-1 [&_[data-slot=input-group-control]]:text-sm [&_[data-slot=input-group-control]]:placeholder:text-foreground-muted [&_[data-slot=input-group]]:h-8 [&_[data-slot=input-group]]:rounded-[10px] [&_[data-slot=input-group]]:border-input [&_[data-slot=input-group]]:bg-background [&_[data-slot=input-group]]:shadow-none">
      <SearchInput
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onClear={() => onValueChange('')}
        clearLabel={t('common.clear')}
        placeholder={`${t('knowledge.search')}...`}
      />
    </div>
  )
}

export default BaseNavigatorSearch
