// Tool approval hooks - unified abstraction for MCP and Agent tool approval
export {
  isBlockWaitingApproval,
  type ToolApprovalActions,
  type ToolApprovalState,
  useAgentToolApproval,
  type UseAgentToolApprovalOptions,
  useMcpToolApproval,
  type UseMcpToolApprovalOptions,
  useToolApproval,
  type UseToolApprovalOptions
} from './useToolApproval'
