import { Badge, Input, Skeleton } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { useDeferredValue, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function LibraryPage() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim())
  const { data, isLoading } = useQuery('/english-learning/units', {
    query: { limit: 100, search: deferredSearch || undefined }
  })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-bold text-2xl">{t('english_learning.library.heading')}</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          {t('english_learning.library.description', { count: data?.total ?? 0 })}
        </p>
      </div>
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t('english_learning.library.search')}
      />
      {isLoading ? <Skeleton className="h-48 w-full rounded-xl" /> : null}
      <div className="space-y-2 [content-visibility:auto]">
        {data?.items.map((unit) => (
          <article key={unit.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-medium text-base">{unit.english}</h2>
                <p className="mt-1 text-muted-foreground text-sm">{unit.meaning}</p>
              </div>
              <div className="flex gap-1">
                <Badge variant="outline">{unit.kind}</Badge>
                {unit.cefr ? <Badge variant="secondary">{unit.cefr}</Badge> : null}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
