import { Button, Checkbox, Input } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import NarrowLayout from '@renderer/components/chat/layout/NarrowLayout'
import type { MessageToolApprovalInput } from '@renderer/components/chat/messages/types'
import Scrollbar from '@renderer/components/Scrollbar'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { toast } from '@renderer/services/toast'
import { cn } from '@renderer/utils/style'
import { ArrowRight, ChevronLeft, ChevronRight, Pencil, X } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ComposerOverride } from '../ComposerContext'
import type { AskUserQuestionComposerRequest } from './askUserQuestionComposerRequest'

export type { AskUserQuestionComposerRequest } from './askUserQuestionComposerRequest'

const logger = loggerService.withContext('AskUserQuestionComposer')

type AskUserQuestionComposerProps = {
  request: AskUserQuestionComposerRequest
  onRespond: (input: MessageToolApprovalInput) => void | Promise<void>
  className?: string
  forceNarrowLayout?: boolean
}

type AskUserQuestionComposerOverrideOptions = {
  request: AskUserQuestionComposerRequest
  onRespond: (input: MessageToolApprovalInput) => void | Promise<void>
}

type AnswersByIndex = Record<number, string[]>

export function createAskUserQuestionComposerOverride({
  request,
  onRespond
}: AskUserQuestionComposerOverrideOptions): ComposerOverride {
  return {
    id: `ask-user-question:${request.approvalId}`,
    priority: 100,
    render: ({ className, forceNarrowLayout }) => (
      <AskUserQuestionComposer
        request={request}
        onRespond={onRespond}
        className={className}
        forceNarrowLayout={forceNarrowLayout}
      />
    )
  }
}

export default function AskUserQuestionComposer({
  request,
  onRespond,
  className,
  forceNarrowLayout = false
}: AskUserQuestionComposerProps) {
  const { t } = useTranslation()
  const [narrowMode] = usePreference('chat.narrow_mode')
  const questions = request.input.questions
  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedAnswers, setSelectedAnswers] = useState<AnswersByIndex>({})
  const [customAnswers, setCustomAnswers] = useState<Record<number, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const currentQuestion = questions[currentIndex]
  const totalQuestions = questions.length
  const isFirstQuestion = currentIndex === 0
  const isLastQuestion = currentIndex === totalQuestions - 1
  const currentCustomAnswer = customAnswers[currentIndex] ?? ''
  const currentCustomAnswerText = currentCustomAnswer.trim()

  const hasAnswerAt = useCallback(
    (index: number, answersByIndex: AnswersByIndex = selectedAnswers) => {
      const selected = answersByIndex[index] ?? []
      return selected.length > 0
    },
    [selectedAnswers]
  )

  const hasAnyAnswer = useCallback(
    (answersByIndex: AnswersByIndex = selectedAnswers) =>
      questions.some((_, index) => hasAnswerAt(index, answersByIndex)),
    [hasAnswerAt, questions, selectedAnswers]
  )

  const selectedForCurrent = selectedAnswers[currentIndex] ?? []
  const hasAnySelectedAnswer = useMemo(() => hasAnyAnswer(selectedAnswers), [hasAnyAnswer, selectedAnswers])
  const customActionSubmitsAll = isLastQuestion && (hasAnySelectedAnswer || !!currentCustomAnswerText)

  const buildAnswers = useCallback(
    (answersByIndex: AnswersByIndex = selectedAnswers) => {
      const answers: Record<string, string> = {}

      questions.forEach((question, index) => {
        const values = answersByIndex[index] ?? []

        if (values.length > 0) {
          answers[question.question] = values.join(', ')
        }
      })

      return answers
    },
    [questions, selectedAnswers]
  )

  const respond = useCallback(
    async (input: MessageToolApprovalInput) => {
      setIsSubmitting(true)
      try {
        await onRespond(input)
      } catch (error) {
        logger.error('Failed to send ask-user-question response', error as Error, {
          approvalId: request.approvalId,
          messageId: request.messageId,
          toolCallId: request.toolCallId
        })
        toast.error(t('agent.toolPermission.error.sendFailed'))
        setIsSubmitting(false)
      }
    },
    [onRespond, request.approvalId, request.messageId, request.toolCallId, t]
  )

  const submitAnswers = useCallback(
    async (answersByIndex: AnswersByIndex = selectedAnswers) => {
      if (!hasAnyAnswer(answersByIndex) || isSubmitting) return

      await respond({
        match: request.match,
        approved: true,
        updatedInput: {
          ...request.input,
          answers: buildAnswers(answersByIndex)
        }
      })
    },
    [buildAnswers, hasAnyAnswer, isSubmitting, request.input, request.match, respond, selectedAnswers]
  )

  const handleDismiss = useCallback(async () => {
    if (isSubmitting) return

    await respond({
      match: request.match,
      approved: false,
      reason: 'User dismissed AskUserQuestion'
    })
  }, [isSubmitting, request.match, respond])

  const completeCurrentQuestion = useCallback(
    (answersByIndex: AnswersByIndex) => {
      if (isLastQuestion) {
        void submitAnswers(answersByIndex)
        return
      }

      setCurrentIndex((index) => Math.min(totalQuestions - 1, index + 1))
    },
    [isLastQuestion, submitAnswers, totalQuestions]
  )

  const handleSelectOption = useCallback(
    (label: string) => {
      const isMultiSelect = currentQuestion?.multiSelect
      if (!currentQuestion || isSubmitting) return

      const current = selectedAnswers[currentIndex] ?? []
      const nextForCurrent = isMultiSelect
        ? current.includes(label)
          ? current.filter((value) => value !== label)
          : [...current, label]
        : [label]
      const nextSelectedAnswers = { ...selectedAnswers, [currentIndex]: nextForCurrent }

      setSelectedAnswers(nextSelectedAnswers)
      if (!isMultiSelect) completeCurrentQuestion(nextSelectedAnswers)
    },
    [completeCurrentQuestion, currentIndex, currentQuestion, isSubmitting, selectedAnswers]
  )

  const handleCustomAction = useCallback(async () => {
    if (isSubmitting) return

    if (currentCustomAnswerText) {
      const nextSelectedAnswers = { ...selectedAnswers, [currentIndex]: [currentCustomAnswerText] }
      setSelectedAnswers(nextSelectedAnswers)
      completeCurrentQuestion(nextSelectedAnswers)
      return
    }

    if (customActionSubmitsAll) {
      await submitAnswers(selectedAnswers)
      return
    }

    if (!isLastQuestion) setCurrentIndex((index) => index + 1)
  }, [
    completeCurrentQuestion,
    currentCustomAnswerText,
    currentIndex,
    customActionSubmitsAll,
    isLastQuestion,
    isSubmitting,
    selectedAnswers,
    submitAnswers
  ])

  if (!currentQuestion) return null

  return (
    <NarrowLayout
      data-composer-viewport-inset-target=""
      narrowMode={forceNarrowLayout || narrowMode}
      withSidePadding
      style={{ width: '100%' }}
      className={cn('relative z-2 pb-3', className)}>
      <div className="rounded-[20px] border-[0.5px] border-border bg-card p-2 shadow-sm">
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 className="line-clamp-1 min-w-0 flex-1 font-medium text-[13px] text-foreground leading-5">
            {currentQuestion.question}
          </h2>

          <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-6 shadow-none"
              aria-label={t('agent.askUserQuestion.previous')}
              disabled={isFirstQuestion || isSubmitting}
              onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}>
              <ChevronLeft className="size-3.5" />
            </Button>
            <span className="min-w-9 text-center text-[11px]">
              {t('agent.askUserQuestion.progress', { current: currentIndex + 1, total: totalQuestions })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-6 shadow-none"
              aria-label={isLastQuestion ? t('agent.askUserQuestion.submit') : t('agent.askUserQuestion.next')}
              disabled={(isLastQuestion && !hasAnySelectedAnswer) || isSubmitting}
              onClick={
                isLastQuestion
                  ? () => void submitAnswers()
                  : () => setCurrentIndex((index) => Math.min(totalQuestions - 1, index + 1))
              }>
              <ChevronRight className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-6 shadow-none"
              aria-label={t('agent.askUserQuestion.close')}
              disabled={isSubmitting}
              onClick={handleDismiss}>
              <X className="size-3.5" />
            </Button>
          </div>
        </div>

        <Scrollbar className="mt-1.5 flex max-h-36 flex-col gap-0.5 overflow-x-hidden">
          {currentQuestion.options.map((option, optionIndex) => {
            const isSelected = selectedForCurrent.includes(option.label)

            return (
              <Button
                key={`${option.label}-${optionIndex}`}
                type="button"
                variant="ghost"
                className={cn(
                  'group h-8 w-full justify-start gap-2 rounded-lg px-2 py-1 text-left shadow-none',
                  'hover:bg-muted focus-visible:bg-muted',
                  isSelected && 'bg-muted'
                )}
                disabled={isSubmitting}
                aria-pressed={isSelected}
                onClick={() => handleSelectOption(option.label)}>
                <span
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full font-medium text-[11px] transition-colors',
                    isSelected
                      ? 'bg-neutral-950 text-white dark:bg-neutral-50 dark:text-neutral-950'
                      : 'bg-muted text-muted-foreground group-hover:bg-neutral-950 group-hover:text-white dark:group-hover:bg-neutral-50 dark:group-hover:text-neutral-950'
                  )}>
                  {optionIndex + 1}
                </span>

                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="min-w-0 max-w-[55%] truncate font-medium text-[13px] text-foreground leading-4">
                    {option.label}
                  </span>
                  {option.description && (
                    <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs leading-4">
                      {option.description}
                    </span>
                  )}
                </span>

                {currentQuestion.multiSelect ? (
                  <Checkbox
                    checked={isSelected}
                    size="sm"
                    aria-hidden="true"
                    tabIndex={-1}
                    className="pointer-events-none"
                  />
                ) : (
                  <ArrowRight
                    className={cn(
                      'size-3.5 shrink-0 text-muted-foreground transition-opacity',
                      isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    )}
                  />
                )}
              </Button>
            )
          })}
        </Scrollbar>

        <div className="mt-1.5 flex items-center gap-1.5 border-border-subtle border-t pt-1.5">
          <div className="relative min-w-0 flex-1">
            <Pencil className="-translate-y-1/2 absolute top-1/2 left-2.5 size-3 text-muted-foreground" />
            <Input
              value={currentCustomAnswer}
              disabled={isSubmitting}
              placeholder={t('agent.askUserQuestion.customPlaceholder')}
              className="h-8 rounded-full border-transparent bg-muted/70 pl-8 text-[13px] shadow-none focus-visible:border-transparent"
              onChange={(event) =>
                setCustomAnswers((prev) => ({
                  ...prev,
                  [currentIndex]: event.target.value
                }))
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void handleCustomAction()
                }
              }}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2 font-medium text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground"
            loading={customActionSubmitsAll && isSubmitting}
            disabled={isSubmitting}
            onClick={handleCustomAction}>
            {currentCustomAnswerText || customActionSubmitsAll
              ? t('agent.askUserQuestion.submit')
              : t('agent.askUserQuestion.skip')}
          </Button>
        </div>
      </div>
    </NarrowLayout>
  )
}
