import { CodeExecutionTool, FunctionDeclarationsTool, GoogleSearchRetrievalTool, Tool } from '@google/generative-ai'
import { isEmpty } from 'lodash'

export function filterInvalidTools(tools: Tool[] | undefined) {
  return tools?.filter((e) => !isToolInvalid(e)) ?? []
}

function isToolInvalid(tool: Tool | undefined) {
  if (tool == undefined) return true
  if (isCodeExecutionTool(tool)) {
    return isEmpty(tool.codeExecution)
  } else if (isGoogleSearchRetrievalTool(tool)) {
    return isEmpty(tool.googleSearchRetrieval)
  } else if (isFunctionDeclarationsTool(tool)) {
    return isEmpty(tool.functionDeclarations)
  } else {
    return true
  }
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
