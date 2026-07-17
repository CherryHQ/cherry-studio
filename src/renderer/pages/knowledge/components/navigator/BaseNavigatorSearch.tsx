import { SearchInput } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

import type { BaseNavigatorSearchProps } from './types'

const BaseNavigatorSearch = ({ value, onValueChange }: BaseNavigatorSearchProps) => {
  const { t } = useTranslation()

  return (
    <div className="[&_[data-ui~='part:input-group']]:h-8 [&_[data-ui~='part:input-group']]:rounded-[10px] [&_[data-ui~='part:input-group']]:border-input [&_[data-ui~='part:input-group']]:bg-background [&_[data-ui~='part:input-group']]:shadow-none [&_[data-ui~='part:input-group-addon']]:px-2.5 [&_[data-ui~='part:input-group-addon']]:text-foreground-muted [&_[data-ui~='part:input-group-addon']_svg]:size-4 [&_[data-ui~='part:input-group-control']]:h-8 [&_[data-ui~='part:input-group-control']]:py-1 [&_[data-ui~='part:input-group-control']]:text-sm [&_[data-ui~='part:input-group-control']]:placeholder:text-foreground-muted">
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
