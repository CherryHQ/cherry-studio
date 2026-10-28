import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import ts from 'typescript'

import { expect, test } from './fixtures'

// Every IpcApi route and `window.api` call the desktop renderer makes must be answered on the Web: by
// the Core Worker, by the page, or not at all because the Web page never makes it. A call that is
// none of these fails only when someone clicks the entry, so this test lists it instead.

const repo = resolve(import.meta.dirname, '../../..')
const webCore = resolve(import.meta.dirname, '..')
const read = (path: string) => readFileSync(path, 'utf-8')

/**
 * Renderer code whose calls the Web page never makes, keyed by a path under `src/renderer` (a file or
 * a folder). `only` limits the entry to those routes or `window.api` calls, for files the page does
 * use; without it the whole path is out of reach.
 */
const unreachable: { path: string; only?: string[]; reason: string }[] = [
  // Pages and windows the Web edition never shows.
  { path: 'pages/code', reason: 'The code tools page; the Web sidebar and launchpad offer only chat and agents.' },
  { path: 'pages/files', reason: 'The files page; the Web sidebar and launchpad offer only chat and agents.' },
  { path: 'pages/knowledge', reason: 'Knowledge bases (hostFeatures.knowledgeBases).' },
  { path: 'pages/notes', reason: 'Notes (hostFeatures.notes).' },
  { path: 'pages/paintings', reason: 'The paintings page; the Web sidebar and launchpad offer only chat and agents.' },
  { path: 'pages/translate', reason: 'The translate page; the Web sidebar and launchpad offer only chat and agents.' },
  { path: 'pages/miniApps', reason: 'Mini apps (hostFeatures.miniApps).' },
  { path: 'pages/releaseNotes', reason: 'Opened after an app update (hostFeatures.appUpdates).' },
  { path: 'windows/screenshot', reason: 'A desktop window the Web edition never opens.' },
  { path: 'windows/selection', reason: 'A desktop window the Web edition never opens.' },
  { path: 'windows/quickAssistant', reason: 'A desktop window the Web edition never opens.' },
  { path: 'windows/subWindow', reason: 'A desktop window the Web edition never opens.' },
  { path: 'components/layout/SubWindowControls.tsx', reason: 'Controls of a detached window (hostFeatures.windows).' },
  {
    path: 'windows/main/hooks/useAutoBackupEvents.ts',
    reason: 'Answers the main process after an automatic backup, which the Web edition never runs.'
  },

  // Settings sections the Web settings menu leaves out (`src/page/settingsMenu.ts`).
  ...[
    'BrowserSettings',
    'ChannelsSettings',
    'ComputerUseSettings.tsx',
    'DataSettings',
    'DependenciesSettings',
    'DeviceConnectionsSettings',
    'McpSettings',
    'QuickAssistantSettings.tsx',
    'ScreenshotSettings',
    'SelectionAssistantSettings',
    'SkillDetails',
    'SubscriptionSettings.tsx',
    'TasksSettings.tsx',
    'WebSearchSettings'
  ].map((section) => ({ path: `pages/settings/${section}`, reason: 'Not in the Web settings menu.' })),

  // Entries the Web edition hides or never offers.
  {
    path: 'pages/settings/AboutSettings/AboutSettings.tsx',
    reason: 'Update checks and developer tools (hostFeatures.appUpdates, hostFeatures.devTools).'
  },
  {
    path: 'pages/settings/AppearanceSettings/AppearanceSettings.tsx',
    reason:
      'App zoom, installed fonts and the settings that restart the program (hostFeatures.appZoom, hostFeatures.systemFonts, hostFeatures.desktopApp).'
  },
  {
    path: 'pages/settings/GeneralSettings/GeneralSettings.tsx',
    reason: 'Restarts the program after a runtime setting (hostFeatures.desktopApp).'
  },
  {
    path: 'pages/settings/ArchiveSettings',
    reason: 'Archived paintings and library files (hostFeatures.paintings, hostFeatures.attachments).'
  },
  {
    path: 'pages/settings/ProviderSettings/ProviderSpecific',
    reason: 'Sign-in and installer panels `src/page/providerSpecificSettings.ts` leaves out.'
  },
  {
    path: 'pages/settings/ProviderSettings/ModelList/DownloadOvmsModelPopup.tsx',
    reason: 'For the OVMS provider, which the provider list hides as `ovms.is_supported` answers false.'
  },
  {
    path: 'pages/settings/ProviderSettings/ProviderList',
    reason: 'Provider logo uploads (hostFeatures.imageUploads).'
  },
  { path: 'components/UserPopup.tsx', reason: 'Avatar uploads (hostFeatures.imageUploads).' },
  { path: 'components/UserProfileEditor.tsx', reason: 'Avatar uploads, in a settings section not in the Web menu.' },
  { path: 'components/UpdateDialogPopup.tsx', reason: 'App updates (hostFeatures.appUpdates).' },
  { path: 'components/ErrorBoundary.tsx', reason: 'Developer tools (hostFeatures.devTools).' },
  { path: 'components/WindowFatalFallback.tsx', reason: 'Developer tools (hostFeatures.devTools).' },
  { path: 'components/feedback', reason: 'Diagnostics and the support agent (hostFeatures.diagnostics).' },
  { path: 'hooks/doctor', reason: 'Diagnostics (hostFeatures.diagnostics).' },
  { path: 'services/modelHealthCheck.ts', reason: 'Diagnostics (hostFeatures.diagnostics).' },
  {
    path: 'components/layout',
    only: ['tab.detach', 'tab.drag_end'],
    reason: 'Moving a tab into its own window (hostFeatures.windows).'
  },
  {
    path: 'hooks/useConversationNavigation.ts',
    reason: 'Opens a conversation window; its entries are hidden (hostFeatures.windows) and the page has tabs.'
  },
  { path: 'hooks/tab', reason: 'Answers navigation the main process starts between windows.' },
  {
    path: 'services/mainWindowNavigation.ts',
    only: ['navigation.open_route_in_main'],
    reason: 'Called from detached windows.'
  },
  {
    path: 'components/ConversationNotificationRuntime.tsx',
    reason: 'Shows notifications from the desktop `NotificationService`, which the Worker does not run.'
  },
  {
    path: 'services/notification/NotificationService.ts',
    reason: 'System notifications of app updates and backups, which the Web edition does not have.'
  },
  { path: 'services/externalOpenTargetService.ts', reason: 'Used by the open-with menu, left out of the page.' },
  {
    path: 'components/chat/HtmlArtifactView.tsx',
    reason: 'Opening a preview in the system browser (hostFeatures.systemApps).'
  },
  {
    path: 'components/CodeBlockView/HtmlArtifactsCard.tsx',
    reason: 'Opening a preview in the system browser (hostFeatures.systemApps).'
  },
  {
    path: 'components/chat/messages/tools/shared/ClickableFilePath.tsx',
    reason: 'Revealing a file in the file manager (hostFeatures.systemApps).'
  },
  {
    path: 'pages/agents/components',
    only: ['window.api.file.openPath', 'export.word.from_markdown', 'ai.agent.session.stop_background_task'],
    reason:
      'Opening folders in the file manager (hostFeatures.systemApps), Word export (turned off by ' +
      '`fixedWebPreferences`) and background tasks, which only Claude Code agents run.'
  },
  {
    path: 'pages/agents/messages/agentMessageListAdapter.tsx',
    only: ['ai.agent.session.open_path', 'mcp.tool.abort_call'],
    reason: 'Opening paths in the file manager (hostFeatures.systemApps); no message component aborts a tool.'
  },
  {
    path: 'pages/home/messages/homeMessageListAdapter.tsx',
    reason:
      'Opening paths in the file manager (hostFeatures.systemApps); no message component aborts a tool ' +
      'or shows a file in its folder.'
  },
  {
    path: 'pages/agents/useClaudeCodeBinary.ts',
    reason: 'Only for Claude Code agents, which the Web edition cannot create.'
  },
  {
    path: 'hooks/chat/useTopicMenuActions.ts',
    only: ['export.word.from_markdown'],
    reason: 'Word export, turned off by `fixedWebPreferences`.'
  },
  {
    path: 'services/ExportService.ts',
    reason:
      'Word, note-app and preset-folder exports: the first two are turned off by `fixedWebPreferences`, ' +
      'the folder is set only in the Data settings.'
  },
  {
    path: 'services/markdownImageExport.ts',
    reason: 'Exports images kept as library files; the Web edition stores none.'
  },
  { path: 'components/ObsidianExportDialog.tsx', reason: 'Obsidian export, turned off by `fixedWebPreferences`.' },
  {
    path: 'components/command/CommandMenus.tsx',
    reason: 'Native menus, which `fixedWebPreferences` turns off.'
  },
  {
    path: 'components/chat/trace/TracePage.tsx',
    reason: 'The trace pane opens only in developer mode, which `fixedWebPreferences` turns off.'
  },

  // Attachments and library files, which the Web edition does not keep.
  { path: 'components/composer/paste', reason: 'Attaching files (hostFeatures.attachments).' },
  { path: 'utils/input.ts', reason: 'Attaching dropped files (hostFeatures.attachments).' },
  { path: 'components/composer/tools', reason: 'Composer tools `src/page/composerTools.ts` leaves out.' },
  {
    path: 'components/chat/messages/hooks/useAttachment.ts',
    reason: 'Opens attachments (hostFeatures.attachments).'
  },
  {
    path: 'components/chat/messages/hooks/useMessageLeafCapabilities.ts',
    reason: 'Opens files attached to messages (hostFeatures.attachments).'
  },
  {
    path: 'components/chat/messages/blocks/MessageImageBlock.tsx',
    reason: 'Images kept as library files; the Web edition stores none.'
  },
  { path: 'hooks/useAvatar.ts', reason: 'Avatars kept as library files (hostFeatures.imageUploads).' },
  {
    path: 'components/chat/panes/useArtifactPanePreviewNavigation.ts',
    reason: 'Previews of library files; the Web edition stores none.'
  },
  {
    path: 'components/chat/panes/ArtifactPane.tsx',
    reason: "Copying a Word document's text (hostFeatures.documentText)."
  },
  {
    path: 'components/chat/citations/CitationsPanel.tsx',
    reason: 'Opens the files knowledge-base citations point to (hostFeatures.knowledgeBases).'
  },
  {
    path: 'components/chat/messages/tools/painting/MessageGenerateImage.tsx',
    reason: 'The image generation tool, one of the built-in tools the Worker leaves out.'
  },
  { path: 'utils/file', reason: 'Library files and attachments; the Web edition stores none.' },
  { path: 'services/fileBatchMutation.ts', reason: 'Library files; the Web edition stores none.' },
  { path: 'hooks/useFiles.ts', reason: 'Picks files for the files page and knowledge bases.' },
  { path: 'components/RichEditor', reason: 'The notes editor (hostFeatures.notes).' },

  // Desktop features the Web edition does not have.
  { path: 'services/voice', reason: 'Dictation and reading aloud (hostFeatures.voice).' },
  { path: 'components/composer/variants/shared/useScreenshotChat.ts', reason: 'Screenshots, off by default.' },
  {
    path: 'hooks/useMiniApps.ts',
    reason: 'Finds the region for mini apps; the launchpad loads none (hostFeatures.miniApps).'
  },
  { path: 'components/MiniApp', reason: 'Mini apps (hostFeatures.miniApps).' },
  { path: 'hooks/useMiniAppInstallPreview.ts', reason: 'Mini apps (hostFeatures.miniApps).' },
  { path: 'hooks/useMiniAppPopup.ts', reason: 'Mini apps (hostFeatures.miniApps).' },
  { path: 'hooks/useMiniAppUpdate.ts', reason: 'Mini apps (hostFeatures.miniApps).' },
  { path: 'components/WebviewHost.tsx', reason: 'Web views, for mini apps and the agent browser.' },
  { path: 'components/WebviewAnnotationControls', reason: 'Web views, for mini apps and the agent browser.' },
  { path: 'hooks/useWebviewDebugging.ts', reason: 'Web views, for mini apps and the agent browser.' },
  { path: 'components/BrowserCursorOverlay.tsx', reason: 'The agent browser (hostFeatures.agentBrowser).' },
  { path: 'components/BrowserImportDialog.tsx', reason: 'The agent browser (hostFeatures.agentBrowser).' },
  { path: 'hooks/agent/useAgentBrowserGuest.ts', reason: 'The agent browser (hostFeatures.agentBrowser).' },
  { path: 'hooks/useKnowledgeBase.ts', reason: 'Knowledge bases (hostFeatures.knowledgeBases).' },
  { path: 'hooks/useKnowledgeItems.ts', reason: 'Knowledge bases (hostFeatures.knowledgeBases).' },
  { path: 'components/SaveToKnowledgePopup.tsx', reason: 'Knowledge bases (hostFeatures.knowledgeBases).' },
  {
    path: 'components/resourceCatalog/dialogs/create/steps/KnowledgeStep.tsx',
    reason: 'Knowledge bases (hostFeatures.knowledgeBases).'
  },
  { path: 'services/NotesService.ts', reason: 'Notes (hostFeatures.notes).' },
  { path: 'services/NotesSearchService.ts', reason: 'Notes (hostFeatures.notes).' },
  {
    path: 'hooks/useLocalModel.ts',
    reason: 'Local models for voice, screenshots and knowledge bases, none of which the Web edition has.'
  },
  {
    path: 'hooks/useAvailableFileProcessors.ts',
    reason: 'File processing settings and knowledge bases, which the Web edition does not have.'
  },
  { path: 'hooks/useApiGateway.ts', reason: 'The API gateway settings, not in the Web settings menu.' },
  { path: 'hooks/useMcpServer.ts', reason: 'MCP servers; no Web agent runtime or settings page uses them.' },
  { path: 'components/McpInteractionHost.tsx', reason: 'Answers MCP servers, which the Web edition does not run.' },
  { path: 'hooks/useSkills.ts', reason: 'Skills, which the Web agent runtime does not support.' },
  { path: 'hooks/useSkillLauncher.tsx', reason: 'Skills, which the Web agent runtime does not support.' },
  { path: 'hooks/resourceCatalog/skillAdapter.ts', reason: 'Skills, which the Web agent runtime does not support.' },
  {
    path: 'components/resourceCatalog/dialogs/skill',
    reason: 'Skills, which the Web agent runtime does not support.'
  },
  {
    path: 'components/resourceCatalog/dialogs/edit/HeartbeatEditorDialog.tsx',
    reason: 'Heartbeats, which the Web agent runtime does not support.'
  },
  { path: 'hooks/agent/useChannels.ts', reason: 'Channels, which the Web agent runtime does not support.' },
  { path: 'hooks/agent/useTasks.ts', reason: 'Scheduled tasks, which the Web agent runtime does not support.' },
  { path: 'services/oauth.ts', reason: 'Provider sign-ins (hostFeatures.providerSignIn).' },
  {
    path: 'hooks/useCherryAccountSession.ts',
    reason: 'The Cherry Studio account, whose panel `src/page/UserAccountPanel.tsx` replaces.'
  },
  {
    path: 'services/cherryCloudAccountPortal.ts',
    reason: 'The Cherry Studio account, whose panel `src/page/UserAccountPanel.tsx` replaces.'
  },
  { path: 'components/LocalBackupManager.tsx', reason: 'Backups, in the Data settings.' },
  { path: 'components/S3BackupManager.tsx', reason: 'Backups, in the Data settings.' },
  { path: 'components/S3Modals.tsx', reason: 'Backups, in the Data settings.' },
  { path: 'components/WebdavBackupManager.tsx', reason: 'Backups, in the Data settings.' },
  { path: 'services/BackupService.ts', reason: 'Backups, in the Data settings.' },
  { path: 'services/NutstoreService.ts', reason: 'Backups, in the Data settings.' },
  { path: 'utils/backupFileName.ts', reason: 'Backups, in the Data settings.' }
]

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: 'utf-8' })
    .filter((file) => /\.tsx?$/.test(file) && !/(^|\/)__tests__\/|\.(test|spec|bench)\.|\.d\.ts$/.test(file))
    .map((file) => join(directory, file))
}

/** The top-level keys of the object literal declared as `const <name>` in `source`. */
function objectKeys(source: string, name: string): string[] {
  const start = source.indexOf(`const ${name}`)
  const block = source.slice(start, source.indexOf('\n}\n', start))
  return [...block.matchAll(/^ {2}'([^']+)':/gm)].map((match) => match[1])
}

/** `window.api` paths that send an `IpcChannel`, mapped to the channel's name, from the desktop preload. */
function preloadChannels(): Map<string, string> {
  const file = ts.createSourceFile('preload.ts', read(join(repo, 'src/preload/preload.ts')), ts.ScriptTarget.Latest)
  const channels = new Map<string, string>()
  const visit = (node: ts.ObjectLiteralExpression, path: string[]) => {
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) || !property.name) continue
      const key = [...path, property.name.getText(file)]
      if (ts.isObjectLiteralExpression(property.initializer)) {
        visit(property.initializer, key)
        continue
      }
      const sent = /ipcRenderer\.(?:invoke|send)\(\s*IpcChannel\.(\w+)/.exec(property.initializer.getText(file))
      if (sent) channels.set(key.join('.'), sent[1])
    }
  }
  file.forEachChild(function find(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'api' && node.initializer) {
      if (ts.isObjectLiteralExpression(node.initializer)) visit(node.initializer, [])
    }
    node.forEachChild(find)
  })
  return channels
}

test('the renderer calls only what the Web edition answers', async ({ page, account, browserName }) => {
  test.skip(browserName !== 'chromium', 'Reads source files; one browser is enough.')
  await page.evaluate((account) => harness.client.open(account), account)
  const workerChannels = new Set(await page.evaluate(() => harness.client.send<string[]>('ipcChannels')))

  const routes = new Set(
    readdirSync(join(repo, 'src/shared/ipc/schemas'))
      .filter((file) => file.endsWith('.ts'))
      .flatMap((file) => [
        ...read(join(repo, 'src/shared/ipc/schemas', file)).matchAll(/^\s+'([a-z][\w.]*)': defineRoute/gm)
      ])
      .map((match) => match[1])
  )
  const channelValues = new Map(
    [...read(join(repo, 'src/shared/IpcChannel.ts')).matchAll(/^\s+(\w+) = '([^']+)'/gm)].map((match) => [
      match[1],
      match[2]
    ])
  )
  const pageSources = sourceFiles(join(webCore, 'src/page')).map(read).join('\n')
  const answered = new Set([
    ...objectKeys(read(join(webCore, 'src/runtime/ipcHandlers.ts')), 'servedHandlers'),
    ...[...pageSources.matchAll(/answerInPage\(\s*'([^']+)'/g)].map((match) => match[1])
  ])
  const answeredChannels = new Set([
    ...workerChannels,
    ...[...pageSources.matchAll(/handleInPage\(\s*IpcChannel\.(\w+)/g)].map((match) => channelValues.get(match[1]))
  ])
  const replaced = new Set(objectKeys(read(join(webCore, 'vite.config.ts')), 'pageModuleReplacements'))
  const apiChannels = preloadChannels()

  const unanswered: { file: string; call: string }[] = []
  const rendererRoot = join(repo, 'src/renderer')
  for (const path of sourceFiles(rendererRoot)) {
    const file = relative(rendererRoot, path)
    if (replaced.has(file)) continue
    const source = read(path)
    const calls = new Set<string>()
    for (const [, literal] of source.matchAll(/['"`]([a-z][\w]*(?:\.[\w]+)+)['"`]/g)) {
      if (routes.has(literal) && !answered.has(literal)) calls.add(literal)
    }
    for (const [, member] of source.matchAll(/window\.api\.([\w$]+(?:\.[\w$]+)*)/g)) {
      const channel = apiChannels.get(member)
      if (channel && !answeredChannels.has(channelValues.get(channel))) calls.add(`window.api.${member}`)
    }
    for (const call of calls) unanswered.push({ file, call })
  }

  const covers = (entry: (typeof unreachable)[number], { file, call }: (typeof unanswered)[number]) =>
    (file === entry.path || file.startsWith(`${entry.path}/`)) && (!entry.only || entry.only.includes(call))
  const uncovered = unanswered.filter((item) => !unreachable.some((entry) => covers(entry, item)))
  expect(
    uncovered.map(({ file, call }) => `${file}: ${call}`),
    'Serve these in the Worker, answer them in the page, hide their entries, or list them in `unreachable`'
  ).toEqual([])
  const stale = unreachable.filter((entry) => !unanswered.some((item) => covers(entry, item)))
  expect(
    stale.map(({ path }) => path),
    'These `unreachable` entries cover no unanswered call'
  ).toEqual([])
})
