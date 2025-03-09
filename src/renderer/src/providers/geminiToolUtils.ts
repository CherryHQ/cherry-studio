import { CodeExecutionTool, FunctionDeclarationsTool, GoogleSearchRetrievalTool, Tool } from '@google/generative-ai'
import { isEmpty } from 'lodash'

export function isToolsEmpty(tools: Tool[] | undefined) {
  if (tools == undefined) return true
  return tools.some((tool) => {
    if (isCodeExecutionTool(tool)) {
      return isEmpty(tool.codeExecution)
    } else if (isGoogleSearchRetrievalTool(tool)) {
      return isEmpty(tool.googleSearchRetrieval)
    } else if (isFunctionDeclarationsTool(tool)) {
      return isEmpty(tool.functionDeclarations)
    }
    return false
  })
}

function isCodeExecutionTool(tool: Tool): tool is CodeExecutionTool {
  return (tool as CodeExecutionTool).codeExecution !== undefined
}

function isGoogleSearchRetrievalTool(tool: Tool): tool is GoogleSearchRetrievalTool {
  return (tool as GoogleSearchRetrievalTool).googleSearchRetrieval !== undefined
}

function isFunctionDeclarationsTool(tool: Tool): tool is FunctionDeclarationsTool {
  return (tool as FunctionDeclarationsTool).functionDeclarations !== undefined
}
