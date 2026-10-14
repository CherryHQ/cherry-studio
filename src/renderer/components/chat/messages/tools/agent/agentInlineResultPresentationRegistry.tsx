import type { ReactElement } from 'react'

import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import type { CherryMessagePart } from '@shared/data/types/message'

import { getCreateAgentResult, isCreateAgentResultPart } from './createAgentResult'
import { CreateAgentToolInline } from './CreateAgentTool'
import { getPrepareDiagnosticReportResult, isPrepareDiagnosticReportResultPart } from './prepareDiagnosticReportResult'
import { PrepareDiagnosticReportTool } from './PrepareDiagnosticReportTool'

interface AgentInlineResultPresentation {
  readonly isResultPart: (part: CherryMessagePart) => boolean
  readonly renderResult: (toolResponse: McpToolResponse | NormalToolResponse) => ReactElement | undefined
}

const AGENT_INLINE_RESULT_PRESENTATIONS = [
  {
    isResultPart: isPrepareDiagnosticReportResultPart,
    renderResult: (toolResponse) => {
      const result = getPrepareDiagnosticReportResult(toolResponse)
      return result ? <PrepareDiagnosticReportTool result={result} /> : undefined
    }
  },
  {
    isResultPart: isCreateAgentResultPart,
    renderResult: (toolResponse) => {
      const result = getCreateAgentResult(toolResponse)
      return result ? <CreateAgentToolInline result={result} /> : undefined
    }
  }
] satisfies readonly AgentInlineResultPresentation[]

export const agentInlineResultPresentationRegistry = {
  isResultPart(part: CherryMessagePart): boolean {
    return AGENT_INLINE_RESULT_PRESENTATIONS.some((presentation) => presentation.isResultPart(part))
  },
  renderResult(toolResponse: McpToolResponse | NormalToolResponse): ReactElement | undefined {
    for (const presentation of AGENT_INLINE_RESULT_PRESENTATIONS) {
      const result = presentation.renderResult(toolResponse)
      if (result) return result
    }
    return undefined
  }
}
