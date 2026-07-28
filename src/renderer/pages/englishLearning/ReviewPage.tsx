import { Badge, Button, Skeleton } from '@cherrystudio/ui'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import type { ReviewRating } from '@shared/data/types/englishLearning'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const directionTranslationKeys = {
  recognition: 'english_learning.review.direction.recognition',
  production: 'english_learning.review.direction.production'
} as const

const ratingTranslationKeys = {
  again: 'english_learning.review.rating.again',
  hard: 'english_learning.review.rating.hard',
  good: 'english_learning.review.rating.good',
  easy: 'english_learning.review.rating.easy'
} as const

export function ReviewPage() {
  const { t } = useTranslation()
  const { data, isLoading, refetch } = useQuery('/english-learning/reviews/today', { query: { limit: 50 } })
  const { trigger: submit, isLoading: isSubmitting } = useMutation('POST', '/english-learning/reviews/submit')
  const [revealed, setRevealed] = useState(false)
  const startedAt = useRef(Date.now())
  const card = data?.items[0]

  useEffect(() => {
    setRevealed(false)
    startedAt.current = Date.now()
  }, [card?.cardId])

  if (isLoading) return <Skeleton className="h-72 w-full rounded-xl" />
  if (!card) {
    return (
      <div className="rounded-xl border border-border bg-card p-10 text-center">
        <h1 className="font-bold text-2xl">{t('english_learning.review.complete')}</h1>
        <p className="mt-2 text-muted-foreground">{t('english_learning.review.complete_description')}</p>
      </div>
    )
  }

  const prompt = card.direction === 'recognition' ? card.unit.english : card.unit.meaning
  const answer = card.direction === 'recognition' ? card.unit.meaning : card.unit.english
  const rate = async (rating: ReviewRating) => {
    await submit({
      body: {
        cardId: card.cardId,
        rating,
        durationMs: Date.now() - startedAt.current,
        clientMutationId: crypto.randomUUID()
      }
    })
    await refetch()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-bold text-2xl">{t('english_learning.review.heading')}</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            {t('english_learning.review.remaining', { count: data?.items.length ?? 0 })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => void ipcApi.request('english_learning.reminder.snooze', {})}>
            {t('english_learning.review.remind_later')}
          </Button>
          <Badge variant="outline">{t(directionTranslationKeys[card.direction])}</Badge>
        </div>
      </div>
      <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-border bg-card p-8 text-center">
        <div className="text-muted-foreground text-xs uppercase tracking-wider">{card.unit.kind}</div>
        <div className="mt-5 max-w-2xl font-medium text-3xl leading-relaxed">{prompt}</div>
        {revealed ? (
          <div className="mt-8 w-full border-border border-t pt-6">
            <div className="font-medium text-xl">{answer}</div>
            {card.unit.usageNote ? <p className="mt-3 text-muted-foreground text-sm">{card.unit.usageNote}</p> : null}
          </div>
        ) : (
          <Button className="mt-8" onClick={() => setRevealed(true)}>
            {t('english_learning.review.show_answer')}
          </Button>
        )}
      </div>
      {revealed ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(['again', 'hard', 'good', 'easy'] as const).map((rating) => (
            <Button
              key={rating}
              variant={rating === 'good' ? 'default' : 'outline'}
              disabled={isSubmitting}
              onClick={() => void rate(rating)}>
              {t(ratingTranslationKeys[rating])}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
