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
    reportArtifacts: 'mcp__cherry_tools__reportArtifacts__485edd409cd8'
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
