import { loggerService } from '@logger'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { selectPendingPermission, toolPermissionsActions } from '@renderer/store/toolPermissions'
import type { NormalToolResponse } from '@renderer/types'
import { Button, Checkbox, Radio, Tag } from 'antd'
import { CheckCircle, CheckCircle2, ChevronLeft, ChevronRight, HelpCircle, Send } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type AskUserQuestionItem,
  type AskUserQuestionToolInput,
  type AskUserQuestionToolOutput,
  parseAskUserQuestionToolInput,
  parseAskUserQuestionToolOutput
} from './MessageAgentTools/types'

const logger = loggerService.withContext('AskUserQuestionCard')

// ==================== Sub Components ====================

interface CardHeaderProps {
  isPending: boolean
  currentIndex: number
  totalQuestions: number
  extra?: ReactNode
}

function CardHeader({ isPending, currentIndex, totalQuestions, extra }: CardHeaderProps) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <HelpCircle className={`h-5 w-5 ${isPending ? 'text-blue-500' : 'text-green-500'}`} />
        <span className="font-semibold text-default-700">
          {t('agent.askUserQuestion.title', 'Questions from Agent')}
        </span>
      </div>
      <span className="text-default-500 text-xs">
        {currentIndex + 1} / {totalQuestions}
        {extra}
      </span>
    </div>
  )
}

interface NavigationProps {
  isFirst: boolean
  isLast: boolean
  onPrevious: () => void
  onNext: () => void
  nextDisabled?: boolean
  rightButton?: ReactNode
}

function Navigation({ isFirst, isLast, onPrevious, onNext, nextDisabled, rightButton }: NavigationProps) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between border-default-200 border-t pt-3">
      <Button icon={<ChevronLeft size={16} />} disabled={isFirst} onClick={onPrevious} className="flex items-center">
        {t('agent.askUserQuestion.previous', 'Previous')}
      </Button>
      {rightButton ?? (
        <Button
          disabled={isLast || nextDisabled}
          onClick={onNext}
          className="flex items-center"
          iconPosition="end"
          icon={<ChevronRight size={16} />}>
          {t('agent.askUserQuestion.next', 'Next')}
        </Button>
      )}
    </div>
  )
}

interface OptionItemProps {
  label: string
  description?: string
  isSelected: boolean
  control: ReactNode
  onClick?: () => void
}

function OptionItem({ label, description, isSelected, control, onClick }: OptionItemProps) {
  return (
    <div
      className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 transition-colors hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 ${
        isSelected
          ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20'
          : 'border-default-200 bg-default-50'
      }`}
      onClick={onClick}>
      {control}
      <div className="min-w-0 flex-1">
        <div className="text-sm">{label}</div>
        {description && <div className="mt-0.5 text-default-500 text-xs">{description}</div>}
      </div>
    </div>
  )
}

// ==================== Completed Mode Content ====================

interface CompletedContentProps {
  question: AskUserQuestionItem
  answer?: string
}

function CompletedContent({ question, answer }: CompletedContentProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Tag color={answer ? 'green' : 'default'} className="m-0">
          {question.header}
        </Tag>
        {answer && <CheckCircle2 className="h-4 w-4 text-green-500" />}
      </div>
      <div className="text-default-700 text-sm">{question.question}</div>
      {answer && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-2 dark:border-green-800 dark:bg-green-900/20">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
          <span className="text-green-700 text-sm dark:text-green-300">{answer}</span>
        </div>
      )}
    </div>
  )
}

// ==================== Pending Mode Content ====================

interface PendingContentProps {
  question: AskUserQuestionItem
  selected: string[]
  hasCustomInput: boolean
  customInputValue: string
  isAnswered: boolean
  onSingleSelect: (label: string) => void
  onMultiSelect: (label: string, checked: boolean) => void
  onCustomInputChange: (value: string) => void
}

function PendingContent({
  question,
  selected,
  hasCustomInput,
  customInputValue,
  isAnswered,
  onSingleSelect,
  onMultiSelect,
  onCustomInputChange
}: PendingContentProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-3">
      {/* Header Tag */}
      <div className="flex items-center gap-2">
        <Tag color={isAnswered ? 'green' : 'blue'} className="m-0">
          {question.header}
        </Tag>
        {question.multiSelect && (
          <Tag color="purple" className="m-0">
            {t('agent.askUserQuestion.multiSelect', 'Multi-select')}
          </Tag>
        )}
        {isAnswered && <CheckCircle className="h-4 w-4 text-green-500" />}
      </div>

      {/* Question */}
      <div className="font-medium text-default-700 text-sm">{question.question}</div>

      {/* Options */}
      <div className="max-h-64 space-y-2 overflow-y-auto">
        {question.multiSelect ? (
          <>
            {question.options.map((option, idx) => (
              <OptionItem
                key={idx}
                label={option.label}
                description={option.description}
                isSelected={selected.includes(option.label)}
                control={<Checkbox checked={selected.includes(option.label)} className="mt-0.5" />}
                onClick={() => onMultiSelect(option.label, !selected.includes(option.label))}
              />
            ))}
            <OptionItem
              label={t('agent.askUserQuestion.other', 'Other')}
              isSelected={hasCustomInput}
              control={<Checkbox checked={hasCustomInput} className="mt-0.5" />}
              onClick={() => onMultiSelect('__other__', !hasCustomInput)}
            />
          </>
        ) : (
          <Radio.Group
            value={hasCustomInput ? '__other__' : selected[0]}
            onChange={(e) => onSingleSelect(e.target.value)}
            className="w-full">
            <div className="space-y-2">
              {question.options.map((option, idx) => (
                <OptionItem
                  key={idx}
                  label={option.label}
                  description={option.description}
                  isSelected={selected.includes(option.label)}
                  control={<Radio value={option.label} className="mt-0.5" />}
                  onClick={() => onSingleSelect(option.label)}
                />
              ))}
              <OptionItem
                label={t('agent.askUserQuestion.other', 'Other')}
                isSelected={hasCustomInput}
                control={<Radio value="__other__" className="mt-0.5" />}
                onClick={() => onSingleSelect('__other__')}
              />
            </div>
          </Radio.Group>
        )}

        {/* Custom input field */}
        {hasCustomInput && (
          <input
            type="text"
            className="mt-2 w-full rounded-lg border border-default-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:bg-default-100"
            placeholder={t('agent.askUserQuestion.customPlaceholder', 'Enter your answer...')}
            value={customInputValue}
            onChange={(e) => onCustomInputChange(e.target.value)}
            autoFocus
          />
        )}
      </div>
    </div>
  )
}

// ==================== Main Component ====================

interface Props {
  toolResponse: NormalToolResponse
}

export function AskUserQuestionCard({ toolResponse }: Props) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const request = useAppSelector((state) => selectPendingPermission(state.toolPermissions, toolResponse.toolCallId))

  const isPending = toolResponse.status === 'pending' && !!request

  const questionInput: AskUserQuestionToolInput | undefined = isPending
    ? parseAskUserQuestionToolInput(request?.input)
    : parseAskUserQuestionToolInput(toolResponse.arguments)

  const completedOutput: AskUserQuestionToolOutput | undefined = parseAskUserQuestionToolOutput(toolResponse.response)
  const completedAnswers = completedOutput?.answers ?? {}

  const questions = useMemo(() => questionInput?.questions ?? [], [questionInput?.questions])

  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string[]>>({})
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({})
  const [showCustomInput, setShowCustomInput] = useState<Record<string, boolean>>({})

  const isSubmitting = request?.status === 'submitting-allow'
  const currentQuestion = questions[currentIndex]
  const totalQuestions = questions.length
  const isFirstQuestion = currentIndex === 0
  const isLastQuestion = currentIndex === totalQuestions - 1

  const isCurrentAnswered = useMemo(() => {
    if (!currentQuestion) return false
    const selected = selectedAnswers[currentQuestion.question] ?? []
    const custom = customInputs[currentQuestion.question]?.trim()
    return selected.length > 0 || (showCustomInput[currentQuestion.question] && !!custom)
  }, [currentQuestion, selectedAnswers, customInputs, showCustomInput])

  const allAnswered = useMemo(() => {
    return questions.every((q) => {
      const selected = selectedAnswers[q.question] ?? []
      const custom = customInputs[q.question]?.trim()
      return selected.length > 0 || (showCustomInput[q.question] && custom)
    })
  }, [questions, selectedAnswers, customInputs, showCustomInput])

  const handleSingleSelect = useCallback((questionText: string, label: string) => {
    if (label === '__other__') {
      setShowCustomInput((prev) => ({ ...prev, [questionText]: true }))
      setSelectedAnswers((prev) => ({ ...prev, [questionText]: [] }))
    } else {
      setShowCustomInput((prev) => ({ ...prev, [questionText]: false }))
      setSelectedAnswers((prev) => ({ ...prev, [questionText]: [label] }))
      setCustomInputs((prev) => ({ ...prev, [questionText]: '' }))
    }
  }, [])

  const handleMultiSelect = useCallback((questionText: string, label: string, checked: boolean) => {
    if (label === '__other__') {
      setShowCustomInput((prev) => ({ ...prev, [questionText]: checked }))
      if (!checked) setCustomInputs((prev) => ({ ...prev, [questionText]: '' }))
    } else {
      setSelectedAnswers((prev) => {
        const current = prev[questionText] ?? []
        return checked
          ? { ...prev, [questionText]: [...current, label] }
          : { ...prev, [questionText]: current.filter((l) => l !== label) }
      })
    }
  }, [])

  const handlePrevious = useCallback(() => {
    if (!isFirstQuestion) setCurrentIndex((prev) => prev - 1)
  }, [isFirstQuestion])

  const handleNext = useCallback(() => {
    if (!isLastQuestion) setCurrentIndex((prev) => prev + 1)
  }, [isLastQuestion])

  const handleSubmit = useCallback(async () => {
    if (!request) return

    const answers: Record<string, string> = {}
    for (const q of questions) {
      const selected = selectedAnswers[q.question] ?? []
      const custom = customInputs[q.question]?.trim()

      if (showCustomInput[q.question] && custom) {
        answers[q.question] = q.multiSelect && selected.length > 0 ? [...selected, custom].join(', ') : custom
      } else if (selected.length > 0) {
        answers[q.question] = selected.join(', ')
      }
    }

    logger.debug('Submitting AskUserQuestion answers', { requestId: request.requestId, answers })
    dispatch(toolPermissionsActions.submissionSent({ requestId: request.requestId, behavior: 'allow' }))

    try {
      const response = await window.api.agentTools.respondToPermission({
        requestId: request.requestId,
        behavior: 'allow' as const,
        updatedInput: { ...request.input, answers }
      })

      if (!response?.success) throw new Error('Response rejected by main process')
      logger.debug('AskUserQuestion answers submitted successfully', { requestId: request.requestId })
    } catch (error) {
      logger.error('Failed to submit AskUserQuestion answers', error as Error)
      window.toast?.error?.(t('agent.toolPermission.error.sendFailed'))
      dispatch(toolPermissionsActions.submissionFailed({ requestId: request.requestId }))
    }
  }, [dispatch, request, questions, selectedAnswers, customInputs, showCustomInput, t])

  // Fallback states
  if (isPending && (!request || !questionInput || !currentQuestion)) {
    return (
      <div className="rounded-xl border border-default-200 bg-default-100 px-4 py-3 text-default-500 text-sm">
        {t('agent.toolPermission.waiting')}
      </div>
    )
  }

  if (!questionInput || questions.length === 0) {
    return (
      <div className="rounded-xl border border-default-200 bg-default-100 px-4 py-3 text-default-500 text-sm">
        {t('agent.askUserQuestion.noQuestions', 'No questions available')}
      </div>
    )
  }

  const answeredCount = Object.keys(completedAnswers).length

  return (
    <div className="w-full max-w-xl rounded-xl border border-default-200 bg-default-100 px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-3">
        <CardHeader
          isPending={isPending}
          currentIndex={currentIndex}
          totalQuestions={totalQuestions}
          extra={
            !isPending && answeredCount > 0
              ? ` · ${answeredCount} ${t('agent.askUserQuestion.answered', 'answered')}`
              : undefined
          }
        />

        {isPending ? (
          <PendingContent
            question={currentQuestion}
            selected={selectedAnswers[currentQuestion.question] ?? []}
            hasCustomInput={showCustomInput[currentQuestion.question] ?? false}
            customInputValue={customInputs[currentQuestion.question] ?? ''}
            isAnswered={isCurrentAnswered}
            onSingleSelect={(label) => handleSingleSelect(currentQuestion.question, label)}
            onMultiSelect={(label, checked) => handleMultiSelect(currentQuestion.question, label, checked)}
            onCustomInputChange={(value) => setCustomInputs((prev) => ({ ...prev, [currentQuestion.question]: value }))}
          />
        ) : (
          <CompletedContent question={currentQuestion} answer={completedAnswers[currentQuestion.question]} />
        )}

        {totalQuestions > 1 && (
          <Navigation
            isFirst={isFirstQuestion}
            isLast={isLastQuestion}
            onPrevious={handlePrevious}
            onNext={handleNext}
            nextDisabled={isPending && !isCurrentAnswered}
            rightButton={
              isPending && isLastQuestion ? (
                <Button
                  type="primary"
                  icon={<Send size={16} />}
                  loading={isSubmitting}
                  disabled={!allAnswered || isSubmitting}
                  onClick={handleSubmit}>
                  {t('agent.askUserQuestion.submit', 'Submit')}
                </Button>
              ) : isPending ? (
                <Button
                  type="primary"
                  disabled={!isCurrentAnswered}
                  onClick={handleNext}
                  iconPosition="end"
                  icon={<ChevronRight size={16} />}>
                  {t('agent.askUserQuestion.next', 'Next')}
                </Button>
              ) : undefined
            }
          />
        )}

        {/* Single question submit button */}
        {totalQuestions === 1 && isPending && (
          <div className="flex justify-end border-default-200 border-t pt-3">
            <Button
              type="primary"
              icon={<Send size={16} />}
              loading={isSubmitting}
              disabled={!allAnswered || isSubmitting}
              onClick={handleSubmit}>
              {t('agent.askUserQuestion.submit', 'Submit')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export default AskUserQuestionCard
