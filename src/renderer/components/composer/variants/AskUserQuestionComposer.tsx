import { ArrowRight, ChevronLeft, ChevronRight, Pencil, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Checkbox, Textarea } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import type { MessageToolApprovalInput } from '@renderer/components/chat/messages/types'
import { toast } from '@renderer/services/toast'
import { cn } from '@renderer/utils/style'

import type { ComposerOverride } from '../ComposerContext'
import type { AskUserQuestionComposerRequest } from './askUserQuestionComposerRequest'
import { readAskUserQuestionDraftCache, writeAskUserQuestionDraftCache } from './askUserQuestionDraftCache'

export type { AskUserQuestionComposerRequest } from './askUserQuestionComposerRequest'

const logger = loggerService.withContext('AskUserQuestionComposer')

type AskUserQuestionComposerProps = {
  request: AskUserQuestionComposerRequest
  onRespond: (input: MessageToolApprovalInput) => void | Promise<void>
  className?: string
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
    render: ({ className }) => <AskUserQuestionComposer request={request} onRespond={onRespond} className={className} />
  }
}

export default function AskUserQuestionComposer({ request, onRespond, className }: AskUserQuestionComposerProps) {
  const { t } = useTranslation()
  const questions = request.input.questions
  // Answers are restored from the cache so a remount (switching conversations and
  // coming back) does not discard what the user already answered but not submitted.
  const [restoredDraft] = useState(() => readAskUserQuestionDraftCache(request.approvalId))
  const [currentIndex, setCurrentIndex] = useState(() =>
    Math.min(Math.max(restoredDraft.currentIndex, 0), Math.max(questions.length - 1, 0))
  )
  const [selectedAnswers, setSelectedAnswers] = useState<AnswersByIndex>(restoredDraft.selectedAnswers)
  const [customAnswers, setCustomAnswers] = useState<Record<number, string>>(restoredDraft.customAnswers)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    writeAskUserQuestionDraftCache(request.approvalId, { selectedAnswers, customAnswers, currentIndex })
  }, [currentIndex, customAnswers, request.approvalId, selectedAnswers])

  const currentQuestion = questions[currentIndex]
  const totalQuestions = questions.length
  const isFirstQuestion = currentIndex === 0
  const isLastQuestion = currentIndex === totalQuestions - 1
  const currentCustomAnswer = customAnswers[currentIndex] ?? ''
  const currentCustomAnswerText = currentCustomAnswer.trim()

  const hasAnswerAt = useCallback(
    (index: number, answersByIndex: AnswersByIndex = selectedAnswers) =>
      (answersByIndex[index] ?? []).length > 0 || !!customAnswers[index]?.trim(),
    [customAnswers, selectedAnswers]
  )

  const hasAnyAnswer = useCallback(
    (answersByIndex: AnswersByIndex = selectedAnswers) =>
      questions.some((_, index) => hasAnswerAt(index, answersByIndex)),
    [hasAnswerAt, questions, selectedAnswers]
  )

  const selectedForCurrent = selectedAnswers[currentIndex] ?? []
  const hasAnyAnswerValue = useMemo(() => hasAnyAnswer(), [hasAnyAnswer])
  const customActionSubmitsAll = isLastQuestion && hasAnyAnswerValue

  const buildAnswers = useCallback(
    (answersByIndex: AnswersByIndex = selectedAnswers) => {
      const answers: Record<string, string> = {}

      questions.forEach((question, index) => {
        const values = answersByIndex[index] ?? []
        const notes = customAnswers[index]?.trim()

        if (values.length > 0) {
          answers[question.question] = values.join(', ')
        } else if (notes) {
          // Typed text without a selection is the answer itself; next to a selection
          // it travels as an `annotations` note instead (see buildAnnotations).
          answers[question.question] = notes
        }
      })

      return answers
    },
    [customAnswers, questions, selectedAnswers]
  )

  const buildAnnotations = useCallback(
    (answersByIndex: AnswersByIndex = selectedAnswers) => {
      const annotations: Record<string, { notes: string }> = {}

      questions.forEach((question, index) => {
        const notes = customAnswers[index]?.trim()
        if (!notes || (answersByIndex[index] ?? []).length === 0) return

        // The typed text supplements a selected option, so it goes out as the
        // protocol's per-question `notes` annotation instead of replacing the answer.
        annotations[question.question] = { notes }
      })

      return Object.keys(annotations).length > 0 ? annotations : undefined
    },
    [customAnswers, questions, selectedAnswers]
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

      const annotations = buildAnnotations(answersByIndex)
      await respond({
        match: request.match,
        approved: true,
        updatedInput: {
          ...request.input,
          answers: buildAnswers(answersByIndex),
          ...(annotations && { annotations })
        }
      })
    },
    [buildAnnotations, buildAnswers, hasAnyAnswer, isSubmitting, request.input, request.match, respond, selectedAnswers]
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
        : current.includes(label)
          ? []
          : [label]
      const nextSelectedAnswers = { ...selectedAnswers, [currentIndex]: nextForCurrent }

      setSelectedAnswers(nextSelectedAnswers)
      if (!isMultiSelect && nextForCurrent.length > 0) completeCurrentQuestion(nextSelectedAnswers)
    },
    [completeCurrentQuestion, currentIndex, currentQuestion, isSubmitting, selectedAnswers]
  )

  const handleCustomAction = useCallback(async () => {
    if (isSubmitting) return

    if (customActionSubmitsAll) {
      await submitAnswers(selectedAnswers)
      return
    }

    if (!isLastQuestion) setCurrentIndex((index) => index + 1)
  }, [customActionSubmitsAll, isLastQuestion, isSubmitting, selectedAnswers, submitAnswers])

  if (!currentQuestion) return null

  return (
    <div
      data-composer-viewport-inset-target=""
      // pointer-events-auto: the composer dock stack is click-through; override
      // composers re-enable interaction on their own root.
      className={cn('pointer-events-auto relative z-2 flex flex-col px-4.5 pt-0 pb-4.5', className)}>
      <div
        className="rounded-[17px] border-[0.5px] border-border p-2.5 backdrop-blur"
        style={{ backgroundColor: 'color-mix(in srgb, var(--background) 88%, transparent)' }}>
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 className="max-h-36 min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words font-semibold text-foreground text-sm leading-5">
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
              disabled={(isLastQuestion && !hasAnyAnswerValue) || isSubmitting}
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
                      ? 'bg-foreground text-background'
                      : 'bg-muted text-muted-foreground group-hover:bg-foreground group-hover:text-background'
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

        <div className="mt-2 flex items-end gap-2 border-border-subtle border-t pt-2">
          <div className="flex min-w-0 flex-1 items-start gap-2 rounded-[12px] bg-muted/70 px-3 py-2">
            <Pencil className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <Textarea.Input
              value={currentCustomAnswer}
              disabled={isSubmitting}
              rows={1}
              placeholder={t('agent.askUserQuestion.customPlaceholder')}
              aria-label={t('agent.askUserQuestion.customPlaceholder')}
              className="max-h-32 min-h-5 resize-none border-transparent bg-transparent p-0 text-sm leading-5 shadow-none focus-visible:border-transparent"
              onValueChange={(value) =>
                setCustomAnswers((prev) => ({
                  ...prev,
                  [currentIndex]: value
                }))
              }
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
                event.preventDefault()
                void handleCustomAction()
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
            {customActionSubmitsAll || currentCustomAnswerText
              ? isLastQuestion
                ? t('agent.askUserQuestion.submit')
                : t('agent.askUserQuestion.next')
              : t('agent.askUserQuestion.skip')}
          </Button>
        </div>
      </div>
    </div>
  )
}
