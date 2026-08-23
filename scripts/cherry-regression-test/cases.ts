import type { EvidenceKind, EvidenceRequirement, RegressionCase } from './types'

function requirement(id: string, kind: EvidenceKind, description: string): EvidenceRequirement {
  return { id, kind, description }
}

function screenshot(id: string): EvidenceRequirement {
  return requirement(id, 'screenshot', 'Capture the final user-visible state')
}

export const REGRESSION_CASES: RegressionCase[] = [
  {
    id: 'S-01',
    title: '应用启动冒烟测试',
    task: 'startup-smoke',
    profile: 'clean',
    modes: ['branch', 'tag'],
    steps: ['Launch with an empty profile and wait for the main window to render visible application content.'],
    acceptance: ['The main window renders visible content without a white screen, crash, or blocking startup error.'],
    evidence: [
      requirement('startup-content', 'ui', 'Observe visible content in the rendered main window'),
      screenshot('startup-screen')
    ]
  },
  {
    id: 'M-01',
    title: '登录 CherryIN 并完成聊天',
    task: 'cherryin-chat',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'If onboarding is visible, choose Set up later. Open provider settings, select CherryIN, and call authenticate-cherryin exactly once when the authorization button is visible.',
      'Click Get model list, fill Search models with configRef cherryInChatModel, verify the exact configured model, click the first exact Add button, and close the drawer without clearing or scrolling the filtered list.',
      'Open Model Check, switch to Check all models, start the check for the only configured model, wait for the persistent Passed status, and record the connection evidence.',
      'Return to Chat, open Selected models by accessible name, filter model-selector-search with configRef cherryInChatModel, select the first option, and send: Reply with exactly CHERRYIN_CHAT_PASS and nothing else. Record the exact response and capture the chat screenshot before restarting.',
      'Restart the application, reopen Settings > Model Provider > CherryIN, and verify that Logged in via OAuth remains visible.'
    ],
    acceptance: [
      'OAuth login state, model list, and connection check are visible and valid.',
      'Chat returns a complete non-error response.',
      'CherryIN remains signed in after restart.'
    ],
    evidence: [
      requirement('cherryin-identity', 'ui', 'Observe the signed-in CherryIN OAuth state'),
      requirement('cherryin-connection', 'ui', 'Observe a successful model connection check'),
      requirement('cherryin-chat-response', 'ui', 'Observe a complete model response in Chat'),
      requirement('cherryin-restart', 'restart', 'Verify the CherryIN session after restart'),
      screenshot('cherryin-chat')
    ]
  },
  {
    id: 'M-02',
    title: '配置自定义服务商并完成聊天',
    task: 'custom-provider-chat',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Open Add Provider. Fill the exact Provider Name* textbox with Cherry Regression Custom Provider 31415 and API Key with configRef customProviderApiKey. Fill Anthropic first and OpenAI second with configRef customProviderBaseUrl so Anthropic remains the preferred chat endpoint. Record the masked API Key input, then click the exact Add button.',
      'On the saved provider, enable its only switch before configuring models. Open Add Model, fill the exact Model ID textbox with configRef customProviderChatModel, and press Enter on that textbox to submit.',
      'Open Add Model again, fill Model ID with configRef customProviderEmbeddingModel, set Chat protocol to OpenAI, expand More Settings, select the exact Embedding model type, and press Enter on Model ID to submit.',
      'Verify the provider page main region contains the saved provider name and both exact model IDs.',
      'Open Model Check, choose configRef customProviderChatModel in the Select Model combobox, start the check, and wait for the persistent Passed status.',
      'Return to Chat, select the exact configured model, and send: Reply with exactly CUSTOM_PROVIDER_CHAT_PASS and nothing else. Record the exact response and capture the chat screenshot before restarting.',
      'Restart the application, reopen the custom provider, and verify that the provider and model remain visible.'
    ],
    acceptance: [
      'Provider and model save successfully and pass connection testing.',
      'Chat returns a complete response.',
      'Configuration survives restart and no secret appears in full plaintext.'
    ],
    evidence: [
      requirement('custom-provider-saved', 'ui', 'Observe the saved provider and both configured models'),
      requirement('custom-provider-connection', 'ui', 'Observe a successful connection check'),
      requirement('custom-provider-chat-response', 'ui', 'Observe a complete model response'),
      requirement('custom-provider-redacted', 'ui', 'Observe that the API key is masked'),
      requirement('custom-provider-restart', 'restart', 'Verify provider persistence after restart'),
      screenshot('custom-provider-chat')
    ]
  },
  {
    id: 'C-01',
    title: '创建自定义助手并聊天',
    task: 'custom-assistant',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Return from Settings if needed, open Add Assistant > New Assistant, fill the exact Name and Description textboxes, choose the star-struck avatar, and select configRef customProviderChatModel through the Model selector.',
      'Continue to System prompt and require every response to include ASSISTANT_PROMPT_PASS, then continue to Knowledge and create the assistant.',
      'Verify the saved assistant, ask what two plus two is, verify ASSISTANT_PROMPT_PASS in the response, and capture the chat screenshot before restarting.',
      'Restart, reopen Cherry Regression Assistant 31415, and verify both the assistant and response remain in its chat history.'
    ],
    acceptance: ['Assistant settings and chat work, and both assistant and history survive restart.'],
    evidence: [
      requirement('assistant-saved', 'ui', 'Observe the assistant and saved settings'),
      requirement('assistant-prompt-response', 'ui', 'Observe behavior required by the system prompt'),
      requirement('assistant-restart', 'restart', 'Verify assistant and history after restart'),
      screenshot('assistant-chat')
    ]
  },
  {
    id: 'C-02',
    title: '使用快捷助手完成全局问答',
    task: 'quick-assistant',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    requiredCapabilities: ['globalShortcut'],
    steps: [
      'Set Quick Assistant Model to configRef customProviderChatModel, enable Quick Assistant in Default Model mode, then search Keyboard Shortcuts for Quick Assistant and enable its existing Cmd/Ctrl+E binding.',
      'Open the external selection fixture, invoke Quick Assistant with Meta+lowercase e on macOS or Control+lowercase e on Windows, and ask for exactly QUICK_ASSISTANT_PASS.',
      'Capture the response, press Escape once to return and once to close, then restart Cherry Studio and repeat the external invocation and prompt.'
    ],
    acceptance: [
      'The external shortcut focuses the input and produces QUICK_ASSISTANT_PASS.',
      'Escape navigation works without disturbing the main window.',
      'Settings and invocation survive restart.'
    ],
    evidence: [
      requirement('quick-external-invocation', 'ui', 'Observe Quick Assistant opened from outside the app'),
      requirement('quick-model-response', 'ui', 'Observe QUICK_ASSISTANT_PASS'),
      requirement('quick-escape-close', 'ui', 'Observe Escape returning and closing the window'),
      requirement('quick-restart', 'restart', 'Verify shortcut invocation after restart'),
      screenshot('quick-assistant')
    ]
  },
  {
    id: 'C-03',
    title: '使用划词助手处理跨应用选中文本',
    task: 'selection-assistant',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    requiredCapabilities: ['externalSelection'],
    steps: [
      'Enable Selection Assistant; on Windows choose Ctrl Key trigger mode, while macOS keeps Selection mode.',
      'Open the external selection fixture; on Windows additionally send the single Control key to show the toolbar.',
      'Record all toolbar actions before opening Explain, reveal Show Original, verify SELECTION_ASSISTANT_PASS in the source and real response, then close the action window.'
    ],
    acceptance: [
      'The toolbar and configured actions appear for external selected text.',
      'The action receives the exact marker and returns a related model result.',
      'Closing it leaves the source application usable and unchanged.'
    ],
    evidence: [
      requirement('selection-source', 'ui', 'Observe the exact selected source marker'),
      requirement('selection-actions', 'ui', 'Observe configured actions in the selection toolbar'),
      requirement('selection-model-response', 'ui', 'Observe a related model response'),
      requirement('selection-source-preserved', 'file', 'Verify the external source fixture remains unchanged'),
      screenshot('selection-assistant')
    ]
  },
  {
    id: 'K-01',
    title: '创建知识库并导入多个文件',
    task: 'knowledge-import',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Create Cherry Regression Knowledge 31415 with configRef customProviderEmbeddingModel, which was configured by M-02.',
      'Choose Folder and use the native picker with fixture knowledgeDirectory to import all prepared files in one operation; wait until every nested file is Ready.',
      'Run Recall Test with What is the regression knowledge answer?, verify CHERRY_KNOWLEDGE_58597, capture the result, then restart and reopen the knowledge base.'
    ],
    acceptance: ['All files complete processing, recall returns the correct file content, and data survives restart.'],
    evidence: [
      requirement('knowledge-file-status', 'ui', 'Observe every imported file in a completed state'),
      requirement('knowledge-recall', 'ui', 'Observe the unique fixture marker from the correct file'),
      requirement('knowledge-restart', 'restart', 'Verify knowledge base and files after restart'),
      screenshot('knowledge-recall-screen')
    ]
  },
  {
    id: 'K-02',
    title: '基于知识库问答并验证引用',
    task: 'knowledge-qa',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Edit Cherry Regression Assistant 31415, open Knowledge, add Cherry Regression Knowledge 31415, and close the autosaved editor.',
      'Ask the linked assistant what the regression knowledge answer is and require the exact marker plus a source citation.',
      'After CHERRY_KNOWLEDGE_58597 appears, record the query and answer, open the ground-truth.txt citation, and verify its detail.'
    ],
    acceptance: ['The answer uses the correct retrieved content and opens a citation to the correct file and excerpt.'],
    evidence: [
      requirement('knowledge-query', 'ui', 'Observe an actual knowledge query result'),
      requirement('knowledge-answer', 'ui', 'Observe the fixture-backed answer'),
      requirement('knowledge-citation', 'ui', 'Open the citation for the correct file and excerpt'),
      screenshot('knowledge-answer-screen')
    ]
  },
  {
    id: 'MCP-01',
    title: '创建并使用 Everything MCP',
    task: 'everything-mcp',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    requiredCapabilities: ['npx'],
    steps: [
      'Create everything with command npx and two-line arguments -y then @modelcontextprotocol/server-everything; enable it and verify get-sum and echo under Tools.',
      'Edit Cherry Regression Assistant 31415, set MCP Mode to Manual, and enable the exact everything server.',
      'Require get-sum with a=31415 and b=27182, verify the real call and result 58597, then restart and verify everything is Connected.'
    ],
    acceptance: ['A real get-sum call uses 31415 and 27182, returns 58597, and reconnects after restart.'],
    evidence: [
      requirement('everything-tools', 'ui', 'Observe get-sum and echo in the connected tool list'),
      requirement('everything-tool-call', 'ui', 'Observe the real get-sum call and parameters'),
      requirement('everything-result', 'ui', 'Observe tool and final answer result 58597'),
      requirement('everything-restart', 'restart', 'Verify reconnection after restart'),
      screenshot('everything-mcp')
    ]
  },
  {
    id: 'A-01',
    title: '默认 Agent 完成 PPT 任务',
    task: 'agent-ppt',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Open Work, select the built-in Cherry Assistant Agent, start a new task if the current session has messages, set its model, and verify agent-workspace is visibly selected before sending.',
      'Require file or shell tools to create cherry-regression-31415.pptx with exact title Cherry Regression 31415 and exactly three slides; approve tools if prompted.',
      'Wait up to five minutes while processing, then verify search activity, validate the fixed PPTX path, and open or preview the generated deck.'
    ],
    acceptance: ['Search and generation tools run, and a valid non-empty PPTX with expected content opens.'],
    evidence: [
      requirement('ppt-search-tool', 'ui', 'Observe real research/search activity'),
      requirement('ppt-file', 'file', 'Validate the generated PPTX structure and size'),
      requirement('ppt-opened', 'ui', 'Observe the generated PPT opening or previewing'),
      screenshot('ppt-result')
    ]
  },
  {
    id: 'A-02',
    title: '从文件夹导入 Skill 并验证生效',
    task: 'skill-import',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Import skillDirectory through Settings > Skills > Add Skill > Local import > Install from directory; verify the catalog entry without toggling its default-on global switch.',
      'Return to Work, open Manage skills from the built-in Cherry Assistant composer Skills panel, leave cherry-regression-fixture on if already enabled or enable it if off, then start a new task.',
      'Fill the regression-marker question before inserting the cherry-regression-fixture token, send without changing the composer again, and wait up to two minutes for exactly SKILL_IMPORT_PASS; do not use the Chat assistant.'
    ],
    acceptance: ['The Skill is recognized, binds successfully, and changes Agent behavior as explicitly required.'],
    evidence: [
      requirement('skill-imported', 'ui', 'Observe the fixture Skill name and description'),
      requirement('skill-behavior', 'ui', 'Observe the deterministic behavior required by the Skill'),
      screenshot('skill-result')
    ]
  },
  {
    id: 'A-03',
    title: 'Claude Agent Runtime',
    task: 'claude-agent-runtime',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Create Cherry Regression Claude Agent 31415 with Advanced: Claude Agent, configRef cherryInChatModel, and the default approval permission; do not import a Skill.',
      'Set agent-workspace and write AGENT_FILE_TASK_PASS to claude-agent-result.txt, approving once if prompted.',
      'Validate the fixed file contract, restart, and reopen the named Agent.'
    ],
    acceptance: [
      'The runtime calls tools, writes the correct file in the selected directory, and preserves the session.'
    ],
    evidence: [
      requirement('claude-runtime', 'ui', 'Observe the selected Claude Agent runtime and compatible model'),
      requirement('claude-file', 'file', 'Validate the generated file and expected content'),
      requirement('claude-restart', 'restart', 'Verify session persistence after restart'),
      screenshot('claude-agent')
    ]
  },
  {
    id: 'A-04',
    title: 'Pi Runtime',
    task: 'pi-runtime',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Create Pi Regression Agent with Fast: Pi, configRef cherryInChatModel, and Ask Before Acting; then set agent-workspace.',
      'Request AGENT_FILE_TASK_PASS in pi-agent-result.txt, record the visible approval, allow it once, and validate the fixed file contract.'
    ],
    acceptance: ['Only compatible models are offered and the approved tool writes the correct retained file.'],
    evidence: [
      requirement('pi-runtime', 'ui', 'Observe Pi with a compatible model'),
      requirement('pi-approval', 'ui', 'Observe and complete the tool approval flow'),
      requirement('pi-file', 'file', 'Validate the generated file and expected content'),
      screenshot('pi-agent')
    ]
  },
  {
    id: 'A-05',
    title: 'DeepSeek Harness Runtime',
    task: 'deepseek-harness-runtime',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Create DeepSeek Harness Agent with the DeepSeek Harness runtime and configRef cherryInChatModel; then set agent-workspace.',
      'Request AGENT_FILE_TASK_PASS in dsh-agent-result.txt, record the visible approval, allow it once, and validate the fixed file contract.'
    ],
    acceptance: ['The runtime calls approved tools and writes the correct retained file.'],
    evidence: [
      requirement('dsh-runtime', 'ui', 'Observe DeepSeek Harness with a compatible model'),
      requirement('dsh-approval', 'ui', 'Observe and complete the tool approval flow'),
      requirement('dsh-file', 'file', 'Validate the generated file and expected content'),
      screenshot('dsh-agent')
    ]
  },
  {
    id: 'P-01',
    title: '使用 Gemini 模型生成图片',
    task: 'image-generation',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Add configRef cherryInGeminiImageModel from the filtered CherryIN Image model list, select it in Paintings, and submit the fixed image prompt.',
      'After the image and 1 / 1 are visible, use its context menu Save As and native-save-picker with geminiImageFile.',
      'Validate the fixed image path, navigate away and back, and verify the prompt remains in history.'
    ],
    acceptance: ['A valid non-blank image and its history remain available after navigation.'],
    evidence: [
      requirement('gemini-image-visible', 'ui', 'Observe the generated image in Paintings'),
      requirement('gemini-image-file', 'file', 'Validate the downloaded image signature and size'),
      requirement('gemini-image-history', 'ui', 'Observe the generation after navigating away and back'),
      screenshot('gemini-image')
    ]
  },
  {
    id: 'P-02',
    title: '使用 Image 2 模型生成图片',
    task: 'image-generation',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Start a New Image, add configRef cherryInImage2Model from the filtered CherryIN Image model list, select it, and submit the same fixed prompt.',
      'After the image and 1 / 1 are visible, use its context menu Save As and native-save-picker with image2File.',
      'Validate the fixed image path and verify the retained prompt after navigating away and back.'
    ],
    acceptance: ['A valid non-blank image and its record remain available.'],
    evidence: [
      requirement('image2-visible', 'ui', 'Observe the generated image in Paintings'),
      requirement('image2-file', 'file', 'Validate the downloaded image signature and size'),
      requirement('image2-history', 'ui', 'Observe the retained image record'),
      screenshot('image2-image')
    ]
  },
  {
    id: 'T-01',
    title: '文本翻译',
    task: 'translation',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Open Translation, select configRef customProviderChatModel from the model icon immediately before Translation History, and fill the exact fixture into translate.input.',
      'Translate once, verify the output retains Neptune, 27182, and TRANSLATION_MARKER, then verify the same entry in Translation History.'
    ],
    acceptance: [
      'Output uses the target language, preserves markers, is non-empty and non-identical, and enters history.'
    ],
    evidence: [
      requirement('text-translation', 'ui', 'Observe translated output with all protected markers'),
      requirement('translation-history', 'ui', 'Observe the completed translation in history'),
      screenshot('text-translation-screen')
    ]
  },
  {
    id: 'T-02',
    title: 'PDF 文件翻译',
    task: 'translation',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    requiredCapabilities: ['systemFilePicker'],
    steps: [
      'Clear the translation input, click Drop or click to upload image/document, and select pdfFile through the native picker.',
      'Wait for PDF_TRANSLATION_MARKER_314159 to be extracted, translate once, and verify the same marker in the result.'
    ],
    acceptance: [
      'The PDF imports, its body is read, translation completes, and the unique source marker is represented.'
    ],
    evidence: [
      requirement('pdf-imported', 'ui', 'Observe successful PDF import and extraction'),
      requirement('pdf-translation', 'ui', 'Observe translated PDF content containing the fixture marker'),
      screenshot('pdf-translation-screen')
    ]
  },
  {
    id: 'APP-01',
    title: '打开小程序',
    task: 'mini-app',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Open Launchpad > MiniApp > ChatGPT and wait for its webview toolbar or loaded content.',
      'Navigate to Chat, then return through Apps > ChatGPT and verify the Mini App remains usable.'
    ],
    acceptance: ['The page avoids a persistent white screen, remains responsive, and works after returning.'],
    evidence: [
      requirement('mini-app-loaded', 'ui', 'Observe loaded Mini App body content'),
      requirement('mini-app-returned', 'ui', 'Observe the Mini App still usable after navigation'),
      screenshot('mini-app')
    ]
  },
  {
    id: 'CODE-01',
    title: '启动 Claude Code',
    task: 'code-cli',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Open Launchpad > Code > Claude Code; configure and enable Cherry Regression Custom Provider 31415 with configRef customProviderChatModel.',
      'Launch with agentWorkspace, then verify the preinstalled Claude Code process remains running from that directory.'
    ],
    acceptance: ['The real process remains running in the selected working directory without a blocking setup error.'],
    evidence: [
      requirement('claude-code-process', 'process', 'Observe a live Claude Code process'),
      requirement('claude-code-directory', 'process', 'Observe the working directory in the live process command'),
      screenshot('claude-code')
    ]
  },
  {
    id: 'CODE-02',
    title: '启动 Codex',
    task: 'code-cli',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Open Launchpad > Code > OpenAI Codex; configure and enable Unified Gateway with configRef customProviderChatModel.',
      'Launch with agentWorkspace, then verify the preinstalled Codex process remains running from that directory.'
    ],
    acceptance: ['The real process remains running in the selected working directory without immediately exiting.'],
    evidence: [
      requirement('codex-process', 'process', 'Observe a live Codex process'),
      requirement('codex-directory', 'process', 'Observe the working directory in the live process command'),
      screenshot('codex')
    ]
  },
  {
    id: 'CODE-03',
    title: '启动 OpenClaw',
    task: 'openclaw',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Open Launchpad > Code > OpenClaw; configure and enable Cherry Regression Custom Provider 31415 with configRef customProviderChatModel.',
      'Launch the preinstalled OpenClaw, verify its real Gateway process and connected Dashboard, then return to Code and stop it.',
      'Verify no owned OpenClaw process remains.'
    ],
    acceptance: ['Dashboard connects while running and the Gateway stops without leaving an owned background process.'],
    evidence: [
      requirement('openclaw-gateway', 'process', 'Observe the running OpenClaw Gateway'),
      requirement('openclaw-dashboard', 'ui', 'Observe Dashboard connected to the local Gateway'),
      requirement('openclaw-stopped', 'process', 'Observe the owned Gateway process stopped'),
      screenshot('openclaw')
    ]
  },
  {
    id: 'N-01',
    title: '创建和保存笔记',
    task: 'notes',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Open Launchpad > Notes, create one note, set its exact title and exact body, commit the title with Enter, and wait for autosave.',
      'Navigate to Chat, return through Launchpad > Notes, and reopen the exact note.',
      'Restart Cherry Studio, return through Launchpad > Notes, and reopen the same note again.'
    ],
    acceptance: ['The exact title and body survive navigation and restart without being overwritten.'],
    evidence: [
      requirement('note-reopened', 'ui', 'Observe exact note content after navigating away and back'),
      requirement('note-restart', 'restart', 'Observe exact note content after restart'),
      screenshot('note')
    ]
  }
]

export function getRegressionCase(caseId: string): RegressionCase {
  const testCase = REGRESSION_CASES.find(({ id }) => id === caseId)
  if (!testCase) throw new Error(`Unknown regression test case: ${caseId}`)
  return testCase
}
