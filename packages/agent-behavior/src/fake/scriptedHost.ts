import type { BehaviorEvent } from '../core/decisions'
import type { ToolCallFact } from '../core/facts'
import type {
  ApprovalAnswer,
  ApprovalHostFacts,
  CallRef,
  HostSettingsSnapshot,
  ModelFacts,
  QuestionAnswer,
  SubagentModelCandidate,
  VerifierVerdict
} from '../core/hostFacts'
import type { HostPorts, OutputFile } from '../ports/host'

export type ScriptedHostOptions = {
  readonly settings: HostSettingsSnapshot
  readonly models?: readonly SubagentModelCandidate[]
  readonly supportsTools?: boolean
  readonly modelKeys?: Pick<ModelFacts, 'parentModelKey' | 'defaultChildModelKey'>
  readonly approvalFacts?: (call: CallRef, tool: ToolCallFact) => ApprovalHostFacts
}
export interface ScriptedHost extends HostPorts {
  answerApproval(answer: ApprovalAnswer): void
  answerQuestion(answer: QuestionAnswer): void
  giveVerdict(verdict: VerifierVerdict): void
  setSettings(patch: Partial<HostSettingsSnapshot>): void
  readonly asked: {
    readonly approvals: number
    readonly questions: number
    readonly verdicts: number
  }
  readonly emitted: readonly BehaviorEvent[]
  readonly saved: readonly OutputFile[]
}

const DEFAULT_APPROVAL_FACTS: ApprovalHostFacts = {
  category: 'other',
  disabled: false,
  autoApproved: false,
  approvalRequired: false,
  nonBypassable: false,
  withinAllowedRoots: false,
  destructive: false
}
const DEFAULT_MODEL_KEYS = { parentModelKey: 'scripted/parent-model', defaultChildModelKey: 'scripted/child-model' }

/** Scripted answers, first in, first out; a request with none queued waits until one is given or its signal aborts. */
function createAnswers<T>() {
  const ready: T[] = []
  const waiting: Array<(answer: T) => void> = []
  return {
    give(answer: T): void {
      const wake = waiting.shift()
      if (wake) wake(answer)
      else ready.push(answer)
    },
    take(signal: AbortSignal): Promise<T> {
      if (signal.aborted) return Promise.reject(signal.reason)
      const answer = ready.shift()
      if (answer !== undefined) return Promise.resolve(answer)
      return new Promise<T>((resolve, reject) => {
        const wake = (given: T) => {
          signal.removeEventListener('abort', abort)
          resolve(given)
        }
        const abort = () => {
          waiting.splice(waiting.indexOf(wake), 1)
          reject(signal.reason)
        }
        waiting.push(wake)
        signal.addEventListener('abort', abort, { once: true })
      })
    }
  }
}

export function createScriptedHost(options: ScriptedHostOptions): ScriptedHost {
  let settings = options.settings
  const counts = { approvals: 0, questions: 0, verdicts: 0 }
  const approvalAnswers = createAnswers<ApprovalAnswer>()
  const questionAnswers = createAnswers<QuestionAnswer>()
  const verdicts = createAnswers<VerifierVerdict>()
  const emitted: BehaviorEvent[] = []
  const saved: OutputFile[] = []

  return {
    approvals: {
      facts: async (call, tool) => options.approvalFacts?.(call, tool) ?? DEFAULT_APPROVAL_FACTS,
      ask: (_request, signal) => {
        counts.approvals += 1
        return approvalAnswers.take(signal)
      }
    },
    questions: {
      ask: (_request, signal) => {
        counts.questions += 1
        return questionAnswers.take(signal)
      }
    },
    models: {
      find: async () => options.models ?? [],
      current: async () => ({
        supportsTools: options.supportsTools ?? true,
        ...(options.modelKeys ?? DEFAULT_MODEL_KEYS)
      })
    },
    verifier: {
      verify: (_request, signal) => {
        counts.verdicts += 1
        return verdicts.take(signal)
      }
    },
    outputStore: {
      save: async (file) => {
        saved.push(file)
        return `outputs/${file.name}`
      }
    },
    observation: { emit: (event) => void emitted.push(event) },
    settings: {
      goalDefaults: () => settings.goalDefaults,
      autonomy: () => settings.autonomy,
      permissionMode: () => settings.permissionMode,
      attendance: () => settings.attendance,
      maxBackground: () => settings.maxBackground,
      offloadThreshold: () => settings.offloadThreshold
    },
    answerApproval: (answer) => approvalAnswers.give(answer),
    answerQuestion: (answer) => questionAnswers.give(answer),
    giveVerdict: (verdict) => verdicts.give(verdict),
    setSettings: (patch) => {
      settings = { ...settings, ...patch }
    },
    get asked() {
      return { ...counts }
    },
    emitted,
    saved
  }
}
