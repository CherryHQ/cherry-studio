/** Provider-visible built-in runtime names. Keep this generated-looking table in sync with the main manifest. */
export const MCP_BUILTIN_RUNTIME_NAMES = {
  cherryTools: {
    webSearch: 'mcp__cherry_tools__webSearch__a26653c54bd6',
    webFetch: 'mcp__cherry_tools__webFetch__0d46b7903981',
    kbSearch: 'mcp__cherry_tools__kbSearch__7fb1469c1b2d',
    kbList: 'mcp__cherry_tools__kbList__1ca9920aae6d',
    kbRead: 'mcp__cherry_tools__kbRead__01a3c9c066e6',
    kbManage: 'mcp__cherry_tools__kbManage__d21480aca963',
    toMarkdown: 'mcp__cherry_tools__toMarkdown__aab95267d667',
    cron: 'mcp__cherry_tools__cron__ceb5bf2c5e21',
    notify: 'mcp__cherry_tools__notify__2484dc7ba152',
    config: 'mcp__cherry_tools__config__7ebbe6253854',
    generateImage: 'mcp__cherry_tools__generateImage__d51e7b5767c3',
    reportArtifacts: 'mcp__cherry_tools__reportArtifacts__485edd409cd8',
    sessionCreate: 'mcp__cherry_tools__sessionCreate__bf114ef2ed86',
    sessionList: 'mcp__cherry_tools__sessionList__0d3afdb9b8d4',
    sessionSearch: 'mcp__cherry_tools__sessionSearch__ccf4c9bf7f37',
    sessionDeliveries: 'mcp__cherry_tools__sessionDeliveries__68bc161a4c4e',
    sessionSend: 'mcp__cherry_tools__sessionSend__c560ab351562',
    cliList: 'mcp__cherry_tools__cliList__0792256a36b7',
    cliSearch: 'mcp__cherry_tools__cliSearch__eddbd7725570',
    cliInstall: 'mcp__cherry_tools__cliInstall__0a5f833ae0d9'
  },
  agentMemory: { memory: 'mcp__agent_memory__memory__b472a1250bce' },
  skills: {
    searchSkills: 'mcp__skills__searchSkills__73d6e4100870',
    installSkill: 'mcp__skills__installSkill__75e07e762fcb'
  },
  assistant: {
    navigate: 'mcp__assistant__navigate__78c92f559d6a',
    productInfo: 'mcp__assistant__productInfo__c0cfa9e1920f',
    diagnose: 'mcp__assistant__diagnose__7461c4bedfe3',
    applySetting: 'mcp__assistant__applySetting__b76773b19eee',
    createAgent: 'mcp__assistant__createAgent__2a307a1740c0'
  },
  assistantFiles: {
    readFile: 'mcp__assistant_files__readFile__5d2275a68b0b',
    moveToTrash: 'mcp__assistant_files__moveToTrash__b1ffadb33d56',
    saveAttachment: 'mcp__assistant_files__saveAttachment__310619340d60'
  }
} as const

export type BuiltinMcpToolIdentity = Readonly<{
  runtimeName: string
  serverId: string
  serverName: string
  name: string
}>

/**
 * Exact built-in bindings for consumers that only receive a runtime name.
 * Runtime names are opaque: external tools must provide their session binding,
 * while this manifest covers the finite in-process tool set.
 */
export const MCP_BUILTIN_TOOL_IDENTITIES: readonly BuiltinMcpToolIdentity[] = [
  ...(
    [
      ['webSearch', 'web_search'],
      ['webFetch', 'web_fetch'],
      ['kbSearch', 'kb_search'],
      ['kbList', 'kb_list'],
      ['kbRead', 'kb_read'],
      ['kbManage', 'kb_manage'],
      ['toMarkdown', 'to_markdown'],
      ['cron', 'cron'],
      ['notify', 'notify'],
      ['config', 'config'],
      ['generateImage', 'generate_image'],
      ['reportArtifacts', 'report_artifacts'],
      ['sessionCreate', 'session_create'],
      ['sessionList', 'session_list'],
      ['sessionSearch', 'session_search'],
      ['sessionDeliveries', 'session_deliveries'],
      ['sessionSend', 'session_send'],
      ['cliList', 'cli_list'],
      ['cliSearch', 'cli_search'],
      ['cliInstall', 'cli_install']
    ] as const
  ).map(([key, name]) => ({
    runtimeName: MCP_BUILTIN_RUNTIME_NAMES.cherryTools[key],
    serverId: 'cherry-tools',
    serverName: 'cherry-tools',
    name
  })),
  {
    runtimeName: MCP_BUILTIN_RUNTIME_NAMES.agentMemory.memory,
    serverId: 'agent-memory',
    serverName: 'agent-memory',
    name: 'memory'
  },
  ...(
    [
      ['searchSkills', 'search_skills'],
      ['installSkill', 'install_skill']
    ] as const
  ).map(([key, name]) => ({
    runtimeName: MCP_BUILTIN_RUNTIME_NAMES.skills[key],
    serverId: 'skills',
    serverName: 'skills',
    name
  })),
  ...(
    [
      ['navigate', 'navigate'],
      ['productInfo', 'product_info'],
      ['diagnose', 'diagnose'],
      ['applySetting', 'apply_setting'],
      ['createAgent', 'create_agent']
    ] as const
  ).map(([key, name]) => ({
    runtimeName: MCP_BUILTIN_RUNTIME_NAMES.assistant[key],
    serverId: 'assistant',
    serverName: 'assistant',
    name
  })),
  ...(
    [
      ['readFile', 'read_file'],
      ['moveToTrash', 'move_to_trash'],
      ['saveAttachment', 'save_attachment']
    ] as const
  ).map(([key, name]) => ({
    runtimeName: MCP_BUILTIN_RUNTIME_NAMES.assistantFiles[key],
    serverId: 'assistant-files',
    serverName: 'assistant-files',
    name
  }))
]

const builtinToolsByRuntimeName = new Map(MCP_BUILTIN_TOOL_IDENTITIES.map((tool) => [tool.runtimeName, tool]))
const builtinRuntimeNamesByLegacyName = new Map(
  MCP_BUILTIN_TOOL_IDENTITIES.map((tool) => [`mcp__${tool.serverName}__${tool.name}`, tool.runtimeName])
)

export function getBuiltinMcpToolIdentity(runtimeName: string): BuiltinMcpToolIdentity | undefined {
  return builtinToolsByRuntimeName.get(runtimeName)
}

/** Upgrade persisted pre-canonical built-in names without attempting to decode arbitrary runtime names. */
export function getBuiltinMcpRuntimeNameFromLegacyName(name: string): string | undefined {
  return builtinRuntimeNamesByLegacyName.get(name)
}
