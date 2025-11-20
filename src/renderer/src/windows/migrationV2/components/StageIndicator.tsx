/**
 * Stage indicator component
 * Shows the current migration stage in a stepper format
 */

import { CheckCircle2, Database, FileArchive, Rocket } from 'lucide-react'
import React from 'react'

import type { MigrationStage } from '../types'

interface Props {
  stage: MigrationStage
}

interface StepInfo {
  id: string
  label: string
  icon: React.ReactNode
}

const steps: StepInfo[] = [
  { id: 'intro', label: '开始', icon: <Rocket className="h-4 w-4" /> },
  { id: 'backup', label: '备份', icon: <FileArchive className="h-4 w-4" /> },
  { id: 'migrate', label: '迁移', icon: <Database className="h-4 w-4" /> },
  { id: 'complete', label: '完成', icon: <CheckCircle2 className="h-4 w-4" /> }
]

function getStepIndex(stage: MigrationStage): number {
  switch (stage) {
    case 'introduction':
      return 0
    case 'backup_required':
    case 'backup_progress':
    case 'backup_confirmed':
      return 1
    case 'migration':
      return 2
    case 'completed':
      return 3
    case 'error':
      return -1
    default:
      return 0
  }
}

export const StageIndicator: React.FC<Props> = ({ stage }) => {
  const currentIndex = getStepIndex(stage)
  const isError = stage === 'error'

  return (
    <div className="mb-8 flex w-full items-center justify-between">
      {steps.map((step, index) => {
        const isCompleted = index < currentIndex
        const isCurrent = index === currentIndex
        const isPending = index > currentIndex

        return (
          <React.Fragment key={step.id}>
            {/* Step indicator */}
            <div className="flex flex-col items-center">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors ${isCompleted ? 'border-green-600 bg-green-600 text-white dark:border-green-400 dark:bg-green-400' : ''}
                  ${isCurrent && !isError ? 'border-primary bg-primary text-white' : ''}
                  ${isCurrent && isError ? 'border-red-600 bg-red-600 text-white dark:border-red-400 dark:bg-red-400' : ''}
                  ${isPending ? 'border-border bg-secondary text-muted-foreground' : ''}
                `}>
                {isCompleted ? <CheckCircle2 className="h-5 w-5" /> : step.icon}
              </div>
              <span
                className={`mt-2 font-medium text-sm ${isCompleted ? 'text-green-600 dark:text-green-400' : ''}
                  ${isCurrent && !isError ? 'text-primary' : ''}
                  ${isCurrent && isError ? 'text-red-600 dark:text-red-400' : ''}
                  ${isPending ? 'text-muted-foreground' : ''}
                `}>
                {step.label}
              </span>
            </div>

            {/* Connector line */}
            {index < steps.length - 1 && (
              <div
                className={`mx-2 h-0.5 flex-1 transition-colors ${index < currentIndex ? 'bg-green-600 dark:bg-green-400' : 'bg-border'}
                `}
              />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}
