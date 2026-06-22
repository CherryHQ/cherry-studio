import { Badge, Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import type { NormalToolResponse } from '@renderer/types'
import { CheckCircle2, ChevronLeft, ChevronRight, HelpCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { AgentToolDisclosure, AgentToolDisclosureLabel } from './AgentToolDisclosure'
import { useAskUserQuestionOptimisticInput } from './AskUserQuestionOptimisticContext'
import { SkeletonValue } from './GenericTools'
import { type AskUserQuestionItem, parseAskUserQuestionToolInput } from './types'

const logger = loggerService.withContext('AskUserQuestionCard')

// ==================== Sub Components ====================

interface NavigationProps {
  isFirst: boolean
  isLast: boolean
  onPrevious: () => void
  onNext: () => void
}

function Navigation({ isFirst, isLast, onPrevious, onNext }: NavigationProps) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between border-default-200 border-t pt-3">
      <Button variant="outline" disabled={isFirst} onClick={onPrevious} className="flex items-center">
        <ChevronLeft size={16} />
        {t('agent.askUserQuestion.previous')}
      </Button>
      <Button variant="outline" disabled={isLast} onClick={onNext} className="flex items-center">
        {t('agent.askUserQuestion.next')}
        <ChevronRight size={16} />
      </Button>
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
      <div className="flex min-w-0 items-center gap-2">
        <Badge variant={answer ? 'secondary' : 'outline'} className="m-0">
          <SkeletonValue value={question?.header} width="60px" />
        </Badge>
        <div className="min-w-0 flex-1 text-default-700 text-sm">
          <SkeletonValue value={question?.question} width="100%" />
        </div>
      </div>
      {answer && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 p-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-primary text-sm">{answer}</span>
        </div>
      )}
    </div>
  )
}

// ==================== Main Component ====================
export function AskUserQuestionCard({ toolResponse }: { toolResponse: NormalToolResponse }) {
  const { t } = useTranslation()
  const optimisticInput = useAskUserQuestionOptimisticInput(toolResponse.toolCallId)

  // Parse from available sources. Completed Claude Code AskUserQuestion
  // parts can keep the original questions in `input` and put user answers
  // in tool `output`, so read both sides.
  const { questions, answers } = useMemo(() => {
    const parsedInput = parseAskUserQuestionToolInput(toolResponse.arguments)
    const parsedOutput = parseAskUserQuestionToolInput(toolResponse.response)
    const parsedOptimisticInput = parseAskUserQuestionToolInput(optimisticInput)
    const questions = parsedInput?.questions ?? parsedOptimisticInput?.questions ?? parsedOutput?.questions ?? []
    const answers = parsedInput?.answers ?? parsedOutput?.answers ?? parsedOptimisticInput?.answers ?? {}

    if (!questions.length) {
      logger.debug('AskUserQuestion: no questions parsed', {
        status: toolResponse.status,
        hasArguments: !!toolResponse.arguments,
        hasResponse: !!toolResponse.response
      })
    }
    return { questions, answers }
  }, [optimisticInput, toolResponse.arguments, toolResponse.response, toolResponse.status])

  const [currentIndex, setCurrentIndex] = useState(0)
  const currentQuestion = questions[currentIndex]
  const totalQuestions = questions.length
  const isFirstQuestion = currentIndex === 0
  const isLastQuestion = currentIndex === totalQuestions - 1

  if (!currentQuestion) return null

  const answeredCount = Object.keys(answers).length

  const content = (
    <div className="flex flex-col gap-3">
      <CompletedContent question={currentQuestion} answer={answers[currentQuestion.question]} />

      {totalQuestions > 1 && (
        <Navigation
          isFirst={isFirstQuestion}
          isLast={isLastQuestion}
          onPrevious={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
          onNext={() => setCurrentIndex((prev) => Math.min(totalQuestions - 1, prev + 1))}
        />
      )}
    </div>
  )

  const toolContentItem: ToolDisclosureItem = {
    key: toolResponse.toolCallId || 'ask-user-question',
    label: (
      <AgentToolDisclosureLabel
        label={
          <div className="flex items-center gap-2">
            <span className="tool-icon flex h-4 w-4 shrink-0 items-center justify-center text-foreground-muted">
              <HelpCircle className="h-4 w-4" />
            </span>
            <span className="text-foreground-secondary">{t('agent.askUserQuestion.title')}</span>
          </div>
        }
        trailing={
          answeredCount > 0 ? (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-foreground-muted text-xs leading-4">
              {answeredCount} {t('agent.askUserQuestion.answered')}
            </span>
          ) : undefined
        }
      />
    ),
    children: content,
    classNames: {
      header: 'min-h-7 px-0 py-0.5 font-normal text-[13px] leading-5 text-foreground-secondary'
    }
  }

  return (
    <AgentToolDisclosure className="w-full max-w-full rounded-none border-0 bg-transparent" item={toolContentItem} />
  )
}

export default AskUserQuestionCard
