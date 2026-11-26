// Generated from codex-cli 0.172.0 with scripts/generate-protocol.mjs.
export type ClientInfo = {
  name: string
  title: string | null
  version: string
}

export type JsonValue =
  | number
  | string
  | boolean
  | Array<JsonValue>
  | {
      [key in string]?: JsonValue
    }
  | null

export type InitializeCapabilities = {
  requiredHumanApproval?: boolean
  explicitGatewayOauth?: boolean
  experimentalApi: boolean
  requestAttestation: boolean
  mcpServerOpenaiFormElicitation?: boolean
  optOutNotificationMethods?: Array<string> | null
  extensions?:
    | {
        [key in string]?: JsonValue
      }
    | null
}

export type InitializeParams = {
  clientInfo: ClientInfo
  capabilities: InitializeCapabilities | null
}

export type ModelListParams = {
  modelProvider?: string | null
  cursor?: string | null
  limit?: number | null
  includeHidden?: boolean | null
}

export type SkillsListParams = {
  cwds?: Array<string>
  forceReload?: boolean
}

export type ConfigReadParams = {
  includeLayers?: boolean
  cwd?: string | null
}

export type AbsolutePathBuf = string

export type MultiAgentMode =
  | {
      custom: string
    }
  | 'explicitRequestOnly'
  | 'proactive'

export type Personality = 'none' | 'friendly' | 'pragmatic'

export type ApprovalsReviewer = 'user' | 'auto_review' | 'guardian_subagent'

export type AskForApproval =
  | 'untrusted'
  | 'on-request'
  | {
      granular: {
        sandbox_approval: boolean
        rules: boolean
        skill_approval: boolean
        request_permissions: boolean
        mcp_elicitations: boolean
      }
    }
  | 'never'

export type DynamicToolFunctionSpec = {
  name: string
  description: string
  inputSchema: JsonValue
  deferLoading?: boolean
}

export type DynamicToolNamespaceTool = {
  type: 'function'
} & DynamicToolFunctionSpec

export type DynamicToolNamespaceSpec = {
  name: string
  description: string
  tools: Array<DynamicToolNamespaceTool>
}

export type DynamicToolSpec =
  | ({
      type: 'function'
    } & DynamicToolFunctionSpec)
  | ({
      type: 'namespace'
    } & DynamicToolNamespaceSpec)

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

export type CapabilityRootLocation = {
  type: 'environment'
  environmentId: string
  path: string
}

export type SelectedCapabilityRoot = {
  id: string
  location: CapabilityRootLocation
}

export type ThreadHistoryMode = 'legacy' | 'paginated'

export type ThreadSource = string

export type ThreadStartSource = 'startup' | 'clear'

export type LegacyAppPathString = string

export type TurnEnvironmentParams = {
  environmentId: string
  cwd: LegacyAppPathString
  runtimeWorkspaceRoots?: Array<LegacyAppPathString> | null
}

export type ThreadStartParams = {
  model?: string | null
  modelProvider?: string | null
  allowProviderModelFallback?: boolean
  serviceTier?: string | null
  cwd?: string | null
  runtimeWorkspaceRoots?: Array<AbsolutePathBuf> | null
  approvalPolicy?: AskForApproval | null
  approvalsReviewer?: ApprovalsReviewer | null
  sandbox?: SandboxMode | null
  permissions?: string | null
  config?:
    | {
        [key in string]?: JsonValue
      }
    | null
  serviceName?: string | null
  baseInstructions?: string | null
  developerInstructions?: string | null
  personality?: Personality | null
  multiAgentMode?: MultiAgentMode | null
  ephemeral?: boolean | null
  historyMode?: ThreadHistoryMode | null
  sessionStartSource?: ThreadStartSource | null
  threadSource?: ThreadSource | null
  projectId?: string | null
  daybreakEnabled?: boolean | null
  daybreakProgramPropagationEnrolled?: boolean | null
  environments?: Array<TurnEnvironmentParams> | null
  dynamicTools?: Array<DynamicToolSpec> | null
  selectedCapabilityRoots?: Array<SelectedCapabilityRoot> | null
  mockExperimentalField?: string | null
  experimentalRawEvents?: boolean
}

export type AgentMessageInputContent =
  | {
      type: 'input_text'
      text: string
    }
  | {
      type: 'encrypted_content'
      encrypted_content: string
    }

export type ReasoningEffort = string

export type ConfigurationReasoning = {
  effort: ReasoningEffort
}

export type ImageDetail = 'auto' | 'low' | 'high' | 'original'

export type ContentItem =
  | {
      type: 'input_text'
      text: string
    }
  | ({
      type: 'input_image'
      detail?: ImageDetail
    } & (
      | {
          image_url: string
        }
      | {
          file_id: string
        }
    ))
  | ({
      type: 'input_audio'
    } & (
      | {
          audio_url: string
        }
      | {
          file_id: string
        }
    ))
  | {
      type: 'output_text'
      text: string
      annotations?: unknown[]
      logprobs?: unknown[]
    }

export type FunctionCallOutputContentItem =
  | {
      type: 'input_text'
      text: string
    }
  | ({
      type: 'input_image'
      detail?: ImageDetail
    } & (
      | {
          image_url: string
        }
      | {
          file_id: string
        }
    ))
  | ({
      type: 'input_audio'
    } & (
      | {
          audio_url: string
        }
      | {
          file_id: string
        }
    ))
  | {
      type: 'encrypted_content'
      encrypted_content: string
    }

export type FunctionCallOutputBody = string | Array<FunctionCallOutputContentItem>

export type InternalChatMessageMetadataPassthrough = {
  turn_id?: string
}

export type LocalShellExecAction = {
  command: Array<string>
  timeout_ms: bigint | null
  working_directory: string | null
  env:
    | {
        [key in string]?: string
      }
    | null
  user: string | null
}

export type LocalShellAction = {
  type: 'exec'
} & LocalShellExecAction

export type LocalShellStatus = 'completed' | 'in_progress' | 'incomplete'

export type MessagePhase = 'commentary' | 'partial_answer' | 'final_answer'

export type ReasoningItemContent =
  | {
      type: 'reasoning_text'
      text: string
    }
  | {
      type: 'text'
      text: string
    }

export type ReasoningItemReasoningSummary = {
  type: 'summary_text'
  text: string
}

export type ResponseItemId = string

export type WebSearchAction =
  | {
      type: 'search'
      query?: string
      queries?: Array<string>
    }
  | {
      type: 'open_page'
      url?: string
    }
  | {
      type: 'find_in_page'
      url?: string
      pattern?: string
    }
  | {
      type: 'other'
    }

export type ResponseItem =
  | {
      type: 'additional_tools'
      id?: ResponseItemId
      role: string
      tools: unknown[]
    }
  | {
      type: 'message'
      encrypted_content?: string
      status?: string
      id?: ResponseItemId
      role: string
      content: Array<ContentItem>
      phase?: MessagePhase
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough
    }
  | {
      type: 'agent_message'
      id?: ResponseItemId
      author: string
      recipient: string
      content: Array<AgentMessageInputContent>
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough
    }
  | {
      type: 'reasoning'
      id?: ResponseItemId
      summary: Array<ReasoningItemReasoningSummary>
      content?: Array<ReasoningItemContent>
      encrypted_content: string | null
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough
    }
  | {
      type: 'local_shell_call'
      encrypted_content?: string
      id?: ResponseItemId
      call_id: string | null
      status: LocalShellStatus
      action: LocalShellAction
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough
    }
  | {
      type: 'function_call'
      encrypted_content?: string
      status?: string
      id?: ResponseItemId
      name: string
      namespace?: string
      arguments: string
      encrypted_function_args?: Array<string>
      call_id: string
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough
    }
  | {
      type: 'tool_search_call'
      encrypted_content?: string
      id?: ResponseItemId
      call_id: string | null
      status?: string
      execution: string
      arguments: unknown
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough
    }
  | {
      type: 'function_call_output'
      id?: ResponseItemId
      call_id?: string
      name?: string
      namespace?: string
      output: FunctionCallOutputBody
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough
    }
  | {
      type: 'custom_tool_call'
      encrypted_content?: string
      id?: ResponseItemId
      status?: string
      call_id: string
      name: string
      namespace?: string
      input: string
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough
    }
  | {
      type: 'custom_tool_call_output'
      id?: ResponseItemId
      call_id: string
      name?: string
      output: FunctionCallOutputBody
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough
    }
  | {
      type: 'tool_search_output'
      id?: ResponseItemId
      call_id: string | null
      status: string
      execution: string
      tools: unknown[]
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough
    }
  | {
      type: 'web_search_call'
      encrypted_content?: string
      id?: ResponseItemId
      status?: string
      action?: WebSearchAction
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough
    }
  | {
      type: 'image_generation_call'
      encrypted_content?: string
      id?: ResponseItemId
      status: string
      revised_prompt?: string
      result: string
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough
    }
  | {
      type: 'compaction'
      id?: ResponseItemId
      encrypted_content: string
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough
    }
  | {
      type: 'configuration_update'
      reasoning: ConfigurationReasoning
    }
  | {
      type: 'compaction_trigger'
    }
  | {
      type: 'context_compaction'
      id?: ResponseItemId
      encrypted_content?: string
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough
    }
  | {
      type: 'other'
    }

export type SortDirection = 'asc' | 'desc'

export type TurnItemsView = 'notLoaded' | 'summary' | 'full'

export type ThreadResumeInitialTurnsPageParams = {
  limit?: number | null
  sortDirection?: SortDirection | null
  itemsView?: TurnItemsView | null
}

export type ThreadResumeParams = {
  threadId: string
  history?: Array<ResponseItem> | null
  path?: string | null
  model?: string | null
  modelProvider?: string | null
  serviceTier?: string | null
  cwd?: string | null
  runtimeWorkspaceRoots?: Array<AbsolutePathBuf> | null
  approvalPolicy?: AskForApproval | null
  approvalsReviewer?: ApprovalsReviewer | null
  sandbox?: SandboxMode | null
  permissions?: string | null
  config?:
    | {
        [key in string]?: JsonValue
      }
    | null
  baseInstructions?: string | null
  developerInstructions?: string | null
  personality?: Personality | null
  excludeTurns?: boolean
  initialTurnsPage?: ThreadResumeInitialTurnsPageParams | null
}

export type ThreadForkParams = {
  threadId: string
  experimentalPredictionMode?: boolean
  experimentalDisablePredictionMcp?: boolean
  lastTurnId?: string | null
  beforeTurnId?: string | null
  path?: string | null
  model?: string | null
  modelProvider?: string | null
  serviceTier?: string | null
  cwd?: string | null
  runtimeWorkspaceRoots?: Array<AbsolutePathBuf> | null
  approvalPolicy?: AskForApproval | null
  approvalsReviewer?: ApprovalsReviewer | null
  sandbox?: SandboxMode | null
  permissions?: string | null
  config?:
    | {
        [key in string]?: JsonValue
      }
    | null
  baseInstructions?: string | null
  developerInstructions?: string | null
  ephemeral?: boolean
  attachToSource?: boolean
  threadSource?: ThreadSource | null
  excludeTurns?: boolean
  deferGoalContinuation?: boolean
}

export type ThreadSetNameParams = {
  threadId: string
  name: string
}

export type ThreadCompactStartParams = {
  threadId: string
}

export type ThreadRevertParams = {
  threadId: string
  beforeTurnId: string
}

export type ThreadTurnsListParams = {
  threadId: string
  cursor?: string | null
  limit?: number | null
  sortDirection?: SortDirection | null
  itemsView?: TurnItemsView | null
}

export type ThreadGoalGetParams = {
  threadId: string
}

export type ThreadGoalMutationOrigin = 'user' | 'automatic'

export type ThreadGoalStatus = 'active' | 'paused' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'complete'

export type ThreadGoalSetParams = {
  threadId: string
  origin?: ThreadGoalMutationOrigin | null
  objective?: string | null
  status?: ThreadGoalStatus | null
  tokenBudget?: number | null
}

export type ThreadGoalClearParams = {
  threadId: string
  origin?: ThreadGoalMutationOrigin | null
}

export type CollaborationModeListParams = Record<string, never>

export type ExperimentalFeatureListParams = {
  cursor?: string | null
  limit?: number | null
  threadId?: string | null
}

export type AdditionalContextKind = 'untrusted' | 'application'

export type AdditionalContextEntry = {
  value: string
  kind: AdditionalContextKind
  name?: string | null
}

export type ByteRange = {
  start: number
  end: number
}

export type TextElement = {
  byteRange: ByteRange
  placeholder: string | null
}

export type UserInput =
  | {
      type: 'text'
      text: string
      text_elements: Array<TextElement>
    }
  | ({
      type: 'image'
      detail?: ImageDetail
    } & (
      | {
          url: string
        }
      | {
          fileId: string
        }
    ))
  | {
      type: 'localImage'
      detail?: ImageDetail
      path: string
    }
  | ({
      type: 'audio'
    } & (
      | {
          url: string
        }
      | {
          fileId: string
        }
    ))
  | {
      type: 'localAudio'
      path: string
    }
  | {
      type: 'skill'
      name: string
      path: string
    }
  | {
      type: 'mention'
      name: string
      path: string
    }

export type TurnSteerParams = {
  threadId: string
  clientUserMessageId?: string | null
  input: Array<UserInput>
  responsesapiClientMetadata?:
    | {
        [key in string]?: string
      }
    | null
  responsesapiClientMetadataPatch?:
    | {
        [key in string]?: string
      }
    | null
  additionalContext?:
    | {
        [key in string]?: AdditionalContextEntry
      }
    | null
  expectedTurnId: string
}

export type ModeKind = 'plan' | 'default'

export type Settings = {
  model: string
  reasoning_effort: ReasoningEffort | null
  developer_instructions: string | null
}

export type CollaborationMode = {
  mode: ModeKind
  settings: Settings
}

export type ReasoningSummary = 'auto' | 'concise' | 'detailed' | 'none'

export type CyberAccessProgram = 'standard' | 'daybreakBlue' | 'daybreakRed'

export type NetworkAccess = 'restricted' | 'enabled'

export type SandboxPolicy =
  | {
      type: 'dangerFullAccess'
    }
  | {
      type: 'readOnly'
      networkAccess: boolean
    }
  | {
      type: 'externalSandbox'
      networkAccess: NetworkAccess
    }
  | {
      type: 'workspaceWrite'
      writableRoots: Array<AbsolutePathBuf>
      networkAccess: boolean
      excludeTmpdirEnvVar: boolean
      excludeSlashTmp: boolean
    }

export type TurnToolOutput = {
  name: string
  namespace: string | null
  output: FunctionCallOutputBody
  retain?: boolean
}

export type TurnStartParams = {
  threadId: string
  disabledPluginIds?: Array<string> | null
  clientUserMessageId?: string | null
  input: Array<UserInput>
  turnTrigger?: string | null
  parentTurnId?: string | null
  rootTurnId?: string | null
  toolOutput?: TurnToolOutput | null
  responsesapiClientMetadata?:
    | {
        [key in string]?: string
      }
    | null
  responsesapiClientMetadataPatch?:
    | {
        [key in string]?: string
      }
    | null
  additionalContext?:
    | {
        [key in string]?: AdditionalContextEntry
      }
    | null
  environments?: Array<TurnEnvironmentParams> | null
  cwd?: string | null
  runtimeWorkspaceRoots?: Array<AbsolutePathBuf> | null
  approvalPolicy?: AskForApproval | null
  approvalsReviewer?: ApprovalsReviewer | null
  sandboxPolicy?: SandboxPolicy | null
  permissions?: string | null
  model?: string | null
  serviceTier?: string | null
  serviceTierForTurn?: string | null
  effort?: ReasoningEffort | null
  summary?: ReasoningSummary | null
  personality?: Personality | null
  outputSchema?: JsonValue | null
  collaborationMode?: CollaborationMode | null
  multiAgentMode?: MultiAgentMode | null
  cyberAccessProgram?: CyberAccessProgram | null
}

export type TurnInterruptParams = {
  threadId: string
  turnId: string
}

export type ReviewDelivery = 'inline'

export type ReviewTarget =
  | {
      type: 'uncommittedChanges'
    }
  | {
      type: 'baseBranch'
      branch: string
    }
  | {
      type: 'commit'
      sha: string
      title: string | null
    }
  | {
      type: 'custom'
      instructions: string
    }

export type ReviewStartParams = {
  threadId: string
  target: ReviewTarget
  delivery?: ReviewDelivery | null
}

export type GetAccountTokenUsageParams = {
  threadId?: string | null
}

export type GetAccountParams = {
  refreshToken?: boolean
}

export type GetAccountRateLimitsParams = {
  supportsLunaReserve?: boolean
  excludeResetCreditDetails?: boolean
}

export type GitDiffToRemoteParams = {
  cwd: string
}

export type CommandExecTerminalSize = {
  rows: number
  cols: number
}

export type CommandExecParams = {
  command: Array<string>
  processId?: string | null
  tty?: boolean
  streamStdin?: boolean
  streamStdoutStderr?: boolean
  outputBytesCap?: number | null
  disableOutputCap?: boolean
  disableTimeout?: boolean
  timeoutMs?: number | null
  cwd?: string | null
  env?:
    | {
        [key in string]?: string | null
      }
    | null
  size?: CommandExecTerminalSize | null
  sandboxPolicy?: SandboxPolicy | null
  permissionProfile?: string | null
}

export type McpServerStatusDetail = 'full' | 'toolsAndAuthOnly'

export type ListMcpServerStatusParams = {
  cursor?: string | null
  limit?: number | null
  detail?: McpServerStatusDetail | null
  threadId?: string | null
  serverName?: string | null
  environmentId?: string | null
}

export type ExecPolicyAmendment = Array<string>

export type NetworkPolicyRuleAction = 'allow' | 'deny'

export type NetworkPolicyAmendment = {
  host: string
  action: NetworkPolicyRuleAction
}

export type CommandExecutionApprovalDecision =
  | 'accept'
  | 'acceptForSession'
  | {
      acceptWithExecpolicyAmendment: {
        execpolicy_amendment: ExecPolicyAmendment
      }
    }
  | {
      applyNetworkPolicyAmendment: {
        network_policy_amendment: NetworkPolicyAmendment
      }
    }
  | 'decline'
  | 'cancel'

export type CommandExecutionRequestApprovalResponse = {
  decision: CommandExecutionApprovalDecision
}

export type FileChangeApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel'

export type FileChangeRequestApprovalResponse = {
  decision: FileChangeApprovalDecision
}

export type FileSystemAccessMode = 'read' | 'write' | 'deny'

export type FileSystemSpecialPath =
  | {
      kind: 'root'
    }
  | {
      kind: 'minimal'
    }
  | {
      kind: 'project_roots'
      subpath: LegacyAppPathString | null
    }
  | {
      kind: 'tmpdir'
    }
  | {
      kind: 'slash_tmp'
    }
  | {
      kind: 'unknown'
      path: string
      subpath: LegacyAppPathString | null
    }

export type FileSystemPath =
  | {
      type: 'path'
      path: LegacyAppPathString
    }
  | {
      type: 'glob_pattern'
      pattern: string
    }
  | {
      type: 'special'
      value: FileSystemSpecialPath
    }

export type FileSystemSandboxEntry = {
  path: FileSystemPath
  access: FileSystemAccessMode
}

export type AdditionalFileSystemPermissions = {
  read: Array<LegacyAppPathString> | null
  write: Array<LegacyAppPathString> | null
  globScanMaxDepth?: number
  entries?: Array<FileSystemSandboxEntry>
}

export type AdditionalNetworkPermissions = {
  enabled: boolean | null
}

export type GrantedPermissionProfile = {
  network?: AdditionalNetworkPermissions
  fileSystem?: AdditionalFileSystemPermissions
}

export type PermissionGrantScope = 'turn' | 'session'

export type PermissionsRequestApprovalResponse = {
  permissions: GrantedPermissionProfile
  scope: PermissionGrantScope
  strictAutoReview?: boolean
}

export type ToolRequestUserInputAnswer = {
  answers: Array<string>
}

export type ToolRequestUserInputResponse = {
  answers: {
    [key in string]?: ToolRequestUserInputAnswer
  }
}

export type McpServerElicitationAction = 'accept' | 'decline' | 'cancel'

export type McpServerElicitationRequestResponse = {
  action: McpServerElicitationAction
  content: JsonValue | null
  _meta: JsonValue | null
}

export interface CodexRequestParams {
  initialize: InitializeParams
  'model/list': ModelListParams
  'skills/list': SkillsListParams
  'config/read': ConfigReadParams
  'thread/start': ThreadStartParams
  'thread/resume': ThreadResumeParams
  'thread/fork': ThreadForkParams
  'thread/name/set': ThreadSetNameParams
  'thread/compact/start': ThreadCompactStartParams
  'thread/revert': ThreadRevertParams
  'thread/turns/list': ThreadTurnsListParams
  'thread/goal/get': ThreadGoalGetParams
  'thread/goal/set': ThreadGoalSetParams
  'thread/goal/clear': ThreadGoalClearParams
  'collaborationMode/list': CollaborationModeListParams
  'experimentalFeature/list': ExperimentalFeatureListParams
  'turn/steer': TurnSteerParams
  'turn/start': TurnStartParams
  'turn/interrupt': TurnInterruptParams
  'review/start': ReviewStartParams
  'account/usage/read': GetAccountTokenUsageParams
  'account/read': GetAccountParams
  'account/rateLimits/read': GetAccountRateLimitsParams
  gitDiffToRemote: GitDiffToRemoteParams
  'command/exec': CommandExecParams
  'mcpServerStatus/list': ListMcpServerStatusParams
}

export interface CodexServerReplies {
  'item/commandExecution/requestApproval': CommandExecutionRequestApprovalResponse
  'item/fileChange/requestApproval': FileChangeRequestApprovalResponse
  'item/permissions/requestApproval': PermissionsRequestApprovalResponse
  'item/tool/requestUserInput': ToolRequestUserInputResponse
  'mcpServer/elicitation/request': McpServerElicitationRequestResponse
}
