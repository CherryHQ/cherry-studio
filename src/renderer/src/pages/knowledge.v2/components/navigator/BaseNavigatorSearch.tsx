import { Input } from '@cherrystudio/ui'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { BaseNavigatorSearchProps } from './types'

const BaseNavigatorSearch = ({ value, onValueChange }: BaseNavigatorSearchProps) => {
  const { t } = useTranslation()

  return (
    <div className="px-2 pb-1.5">
      <div className="flex h-6.75 items-center gap-1.5 rounded-md border border-transparent bg-muted/50 px-2 py-1 transition-colors focus-within:border-border/50">
        <Search className="size-3.5 shrink-0 text-muted-foreground/70" />
        <Input
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={`${t('knowledge_v2.search')}...`}
          className="h-auto flex-1 border-0 bg-transparent px-0 py-0 text-[0.6875rem] text-foreground leading-4.125 shadow-none placeholder:text-muted-foreground/40 focus-visible:border-0 focus-visible:ring-0 md:text-[0.6875rem]"
        />
      </div>
    </div>
  )
}

export default BaseNavigatorSearch
