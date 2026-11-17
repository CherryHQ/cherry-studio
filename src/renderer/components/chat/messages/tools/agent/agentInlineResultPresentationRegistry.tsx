import type { ReactElement } from 'react'

import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import { isDeferredToolOutput, isPersistedToolOutput } from '@shared/ai/transport'
import type { CherryMessagePart } from '@shared/data/types/message'

import { useToolResponsePreview } from '../useToolResponsePreview'
import { getCreateAgentResult, isCreateAgentResultPart, isCreateAgentToolResponse } from './createAgentResult'
import { CreateAgentToolInline } from './CreateAgentTool'
import { getAgentNavigateResult, isAgentNavigateResultPart, isAgentNavigateResponse } from './navigateResult'
import { NavigateToolInline } from './NavigateTool'
import {
  getPrepareDiagnosticReportResult,
  isPrepareDiagnosticReportResultPart,
  isPrepareDiagnosticReportToolResponse
} from './prepareDiagnosticReportResult'
import { PrepareDiagnosticReportTool } from './PrepareDiagnosticReportTool'
import { getScheduledTaskResult, isScheduledTaskResultPart, isTaskWriteToolResponse } from './scheduledTaskResult'
import { ScheduledTaskToolInline } from './ScheduledTaskTool'

interface AgentInlineResultPresentation {
  readonly matches: (response: McpToolResponse | NormalToolResponse) => boolean
  readonly isResultPart: (part: CherryMessagePart) => boolean
  readonly renderResult: (toolResponse: McpToolResponse | NormalToolResponse) => ReactElement | undefined
}

const AGENT_INLINE_RESULT_PRESENTATIONS = [
  {
    isResultPart: isAgentNavigateResultPart,
    matches: isAgentNavigateResponse,
    renderResult: (toolResponse) => {
      const result = getAgentNavigateResult(toolResponse)
      return result ? <NavigateToolInline input={result.input} output={result.output} /> : undefined
    }
  },
  {
    isResultPart: isPrepareDiagnosticReportResultPart,
    matches: isPrepareDiagnosticReportToolResponse,
    renderResult: (toolResponse) => {
      const result = getPrepareDiagnosticReportResult(toolResponse)
      return result ? <PrepareDiagnosticReportTool result={result} /> : undefined
    }
  },
  {
    isResultPart: isCreateAgentResultPart,
    matches: isCreateAgentToolResponse,
    renderResult: (toolResponse) => {
      const result = getCreateAgentResult(toolResponse)
      return result ? <CreateAgentToolInline result={result} /> : undefined
    }
  },
  {
    isResultPart: isScheduledTaskResultPart,
    matches: isTaskWriteToolResponse,
    renderResult: (toolResponse) => {
      const result = getScheduledTaskResult(toolResponse)
      return result ? <ScheduledTaskToolInline result={result} /> : undefined
    }
  }
] satisfies readonly AgentInlineResultPresentation[]

export const agentInlineResultPresentationRegistry = {
  isResultPart(part: CherryMessagePart): boolean {
    return AGENT_INLINE_RESULT_PRESENTATIONS.some((presentation) => presentation.isResultPart(part))
  },
  renderResult(toolResponse: McpToolResponse | NormalToolResponse): ReactElement | undefined {
    for (const presentation of AGENT_INLINE_RESULT_PRESENTATIONS) {
      if (
        presentation.matches(toolResponse) &&
        (isDeferredToolOutput(toolResponse.response) || isPersistedToolOutput(toolResponse.response))
      ) {
        return <PreviewResult presentation={presentation} toolResponse={toolResponse} />
      }
      const result = presentation.renderResult(toolResponse)
      if (result) return result
    }
    return undefined
  }
}

function PreviewResult({
  presentation,
  toolResponse
}: {
  presentation: AgentInlineResultPresentation
  toolResponse: McpToolResponse | NormalToolResponse
}) {
  const preview = useToolResponsePreview(toolResponse)
  return presentation.renderResult(preview.toolResponse) ?? null
}
