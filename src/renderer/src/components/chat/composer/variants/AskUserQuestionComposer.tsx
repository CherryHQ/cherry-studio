import { Button, Checkbox, Input } from '@cherrystudio/ui'
import type { MessageToolApprovalInput } from '@renderer/components/chat/messages/types'
import { cn } from '@renderer/utils/style'
import { ArrowRight, ChevronLeft, ChevronRight, Pencil, X } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AskUserQuestionComposerRequest } from '../askUserQuestion'

type AskUserQuestionComposerProps = {
  request: AskUserQuestionComposerRequest
  onRespond: (input: MessageToolApprovalInput) => void | Promise<void>
  className?: string
}

type AnswersByIndex = Record<number, string[]>

export default function AskUserQuestionComposer({ request, onRespond, className }: AskUserQuestionComposerProps) {
  const { t } = useTranslation()
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

  const areAllAnswered = useCallback(
    (answersByIndex: AnswersByIndex = selectedAnswers) =>
      questions.length > 0 && questions.every((_, index) => hasAnswerAt(index, answersByIndex)),
    [hasAnswerAt, questions, selectedAnswers]
  )

  const allAnswered = useMemo(() => areAllAnswered(selectedAnswers), [areAllAnswered, selectedAnswers])
  const selectedForCurrent = selectedAnswers[currentIndex] ?? []
  const customActionSubmitsAll = isLastQuestion && (allAnswered || !!currentCustomAnswerText)

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
      } catch {
        window.toast.error(t('agent.toolPermission.error.sendFailed'))
        setIsSubmitting(false)
      }
    },
    [onRespond, t]
  )

  const submitAnswers = useCallback(
    async (answersByIndex: AnswersByIndex = selectedAnswers) => {
      if (!areAllAnswered(answersByIndex) || isSubmitting) return

      await respond({
        match: request.match,
        approved: true,
        updatedInput: {
          ...request.input,
          answers: buildAnswers(answersByIndex)
        }
      })
    },
    [areAllAnswered, buildAnswers, isSubmitting, request.input, request.match, respond, selectedAnswers]
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
    <div
      className={cn(
        'relative z-[2] flex flex-col px-[18px] pt-0 pb-[18px] [[navbar-position=top]_&]:pb-2.5',
        className
      )}>
      <div className="rounded-[17px] border-(--color-border) border-[0.5px] bg-(--color-background-opacity) p-2.5 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 className="line-clamp-1 min-w-0 flex-1 font-semibold text-foreground text-sm leading-5">
            {currentQuestion.question}
          </h2>

          <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 shadow-none"
              aria-label={t('agent.askUserQuestion.previous')}
              disabled={isFirstQuestion || isSubmitting}
              onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-11 text-center text-xs">
              {t('agent.askUserQuestion.progress', { current: currentIndex + 1, total: totalQuestions })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 shadow-none"
              aria-label={isLastQuestion ? t('agent.askUserQuestion.submit') : t('agent.askUserQuestion.next')}
              disabled={(isLastQuestion && !allAnswered) || isSubmitting}
              onClick={
                isLastQuestion
                  ? () => void submitAnswers()
                  : () => setCurrentIndex((index) => Math.min(totalQuestions - 1, index + 1))
              }>
              <ChevronRight className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 shadow-none"
              aria-label={t('agent.askUserQuestion.close')}
              disabled={isSubmitting}
              onClick={handleDismiss}>
              <X className="size-4" />
            </Button>
          </div>
        </div>

        <div className="mt-2 flex flex-col gap-1.5">
          {currentQuestion.options.map((option, optionIndex) => {
            const isSelected = selectedForCurrent.includes(option.label)

            return (
              <Button
                key={`${option.label}-${optionIndex}`}
                type="button"
                variant="ghost"
                className={cn(
                  'group h-auto min-h-11 w-full justify-start gap-3 whitespace-normal rounded-[12px] px-3 py-2 text-left shadow-none',
                  'hover:bg-muted focus-visible:bg-muted',
                  isSelected && 'bg-muted'
                )}
                disabled={isSubmitting}
                aria-pressed={isSelected}
                onClick={() => handleSelectOption(option.label)}>
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full font-semibold text-sm transition-colors',
                    isSelected
                      ? 'bg-neutral-950 text-white dark:bg-neutral-50 dark:text-neutral-950'
                      : 'bg-muted text-muted-foreground group-hover:bg-neutral-950 group-hover:text-white dark:group-hover:bg-neutral-50 dark:group-hover:text-neutral-950'
                  )}>
                  {optionIndex + 1}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-foreground text-sm leading-5">{option.label}</span>
                  {option.description && (
                    <span className="block truncate font-medium text-muted-foreground text-xs leading-4">
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
                      'size-4 shrink-0 text-muted-foreground transition-opacity',
                      isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    )}
                  />
                )}
              </Button>
            )
          })}
        </div>

        <div className="mt-2 flex items-center gap-2 border-border-subtle border-t pt-2">
          <div className="relative min-w-0 flex-1">
            <Pencil className="-translate-y-1/2 absolute top-1/2 left-3 size-3.5 text-muted-foreground" />
            <Input
              value={currentCustomAnswer}
              disabled={isSubmitting}
              placeholder={t('agent.askUserQuestion.customPlaceholder')}
              className="h-9 rounded-full border-transparent bg-muted/70 pl-9 text-sm shadow-none focus-visible:border-transparent"
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
            className="h-9 px-2.5 font-semibold text-muted-foreground text-sm shadow-none hover:bg-transparent hover:text-foreground"
            loading={customActionSubmitsAll && isSubmitting}
            disabled={isSubmitting}
            onClick={handleCustomAction}>
            {currentCustomAnswerText || customActionSubmitsAll
              ? t('agent.askUserQuestion.submit')
              : t('agent.askUserQuestion.skip')}
          </Button>
        </div>
      </div>
    </div>
  )
}
