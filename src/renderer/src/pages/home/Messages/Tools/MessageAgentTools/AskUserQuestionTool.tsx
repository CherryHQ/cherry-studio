import type { CollapseProps } from 'antd'
import { Card, Tag } from 'antd'
import { CheckCircle2, CircleDot, HelpCircle } from 'lucide-react'

import { ToolTitle } from './GenericTools'
import type { AskUserQuestionToolInput, AskUserQuestionToolOutput } from './types'
import { AgentToolsType } from './types'

export function AskUserQuestionTool({
  input,
  output
}: {
  input?: AskUserQuestionToolInput
  output?: AskUserQuestionToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const questions = Array.isArray(input?.questions) ? input.questions : []
  const answers = output?.answers ?? {}
  const answeredCount = Object.keys(answers).length

  return {
    key: AgentToolsType.AskUserQuestion,
    label: (
      <ToolTitle
        icon={<HelpCircle className="h-4 w-4" />}
        label="Ask User Question"
        params={answeredCount > 0 ? `${answeredCount} answered` : undefined}
        stats={`${questions.length} ${questions.length === 1 ? 'question' : 'questions'}`}
      />
    ),
    children: (
      <div className="space-y-4">
        {questions.map((questionItem, qIndex) => {
          const answer = answers[questionItem.header]
          const hasAnswer = answer !== undefined

          return (
            <Card
              key={qIndex}
              className="shadow-sm"
              styles={{
                body: { padding: 12 }
              }}>
              <div className="space-y-3">
                {/* Header Tag */}
                <div className="flex items-center gap-2">
                  <Tag color={hasAnswer ? 'green' : 'blue'} className="m-0">
                    {questionItem.header}
                  </Tag>
                  {questionItem.multiSelect && (
                    <Tag color="purple" className="m-0">
                      Multi-select
                    </Tag>
                  )}
                </div>

                {/* Question */}
                <div className="font-medium text-default-700 text-sm">{questionItem.question}</div>

                {/* Options */}
                <div className="space-y-2">
                  {questionItem.options.map((option, oIndex) => {
                    const isSelected = hasAnswer && answer.includes(option.label)

                    return (
                      <div
                        key={oIndex}
                        className={`flex items-start gap-2 rounded-lg border p-2 transition-colors ${
                          isSelected
                            ? 'border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-900/20'
                            : 'border-default-200 bg-default-50'
                        }`}>
                        <div className="mt-0.5 flex-shrink-0">
                          {isSelected ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : (
                            <CircleDot className="h-4 w-4 text-default-400" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div
                            className={`text-sm ${isSelected ? 'font-medium text-green-700 dark:text-green-300' : ''}`}>
                            {option.label}
                          </div>
                          {option.description && (
                            <div className="mt-0.5 text-default-500 text-xs">{option.description}</div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* User Answer Display */}
                {hasAnswer && (
                  <div className="mt-2 border-default-200 border-t pt-2">
                    <div className="text-default-500 text-xs">
                      <span className="font-medium">Answer:</span> {answer}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )
        })}
      </div>
    )
  }
}
