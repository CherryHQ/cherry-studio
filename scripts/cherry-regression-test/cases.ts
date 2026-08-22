import type { EvidenceKind, EvidenceRequirement, RegressionCase, SuiteId } from './types'

export const SUITE_IDS: SuiteId[] = ['suite-1', 'suite-2', 'suite-3', 'suite-4', 'suite-5', 'suite-6']

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
    suite: 'suite-1',
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
    suite: 'suite-2',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Open provider settings, select CherryIN, and sign in with the configured test account.',
      'Select the configured CherryIN chat model and run its connection check.',
      'Ask the default assistant to reply exactly CHERRYIN_CHAT_PASS, then restart the application.'
    ],
    acceptance: [
      'Identity, model list, and connection check are visible and valid.',
      'Chat returns a complete non-error response.',
      'CherryIN remains signed in after restart.'
    ],
    evidence: [
      requirement('cherryin-identity', 'ui', 'Observe the signed-in CherryIN identity'),
      requirement('cherryin-connection', 'ui', 'Observe a successful model connection check'),
      requirement('cherryin-chat-response', 'ui', 'Observe a complete model response in Chat'),
      requirement('cherryin-restart', 'restart', 'Verify the CherryIN session after restart'),
      screenshot('cherryin-chat')
    ]
  },
  {
    id: 'M-02',
    title: '配置自定义服务商并完成聊天',
    suite: 'suite-2',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Create Cherry Regression Custom Provider 31415 using the configured Base URL, API key, and chat model.',
      'Enable the provider and model, then run the connection check.',
      'Ask Chat to reply exactly CUSTOM_PROVIDER_CHAT_PASS, then restart the application.'
    ],
    acceptance: [
      'Provider and model save successfully and pass connection testing.',
      'Chat returns a complete response.',
      'Configuration survives restart and no secret appears in full plaintext.'
    ],
    evidence: [
      requirement('custom-provider-saved', 'ui', 'Observe the saved provider and model'),
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
    suite: 'suite-2',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Create Cherry Regression Assistant 31415 with an avatar, model, description, and a system prompt requiring ASSISTANT_PROMPT_PASS.',
      'Chat with the assistant and verify the system prompt affects its response.',
      'Restart and reopen the assistant and conversation.'
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
    suite: 'suite-2',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    requiredCapabilities: ['globalShortcut'],
    steps: [
      'Enable Quick Assistant with a verified model and set the global shortcut to Cmd/Ctrl+E.',
      'From outside Cherry Studio, invoke it and ask for exactly QUICK_ASSISTANT_PASS.',
      'Close it with Escape, restart Cherry Studio, and invoke it again.'
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
    suite: 'suite-2',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    requiredCapabilities: ['externalSelection'],
    steps: [
      'Enable Selection Assistant and grant required macOS permissions when available.',
      'Select SELECTION_ASSISTANT_PASS in an external text application.',
      'Open Explain, verify the exact source text and a real related model response, then close the action window.'
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
    suite: 'suite-3',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Configure the custom-provider embedding model and create Cherry Regression Knowledge 31415.',
      'Import all prepared knowledge fixture files in one operation and wait for completion.',
      'Run recall testing for the fixture marker, then restart.'
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
    suite: 'suite-3',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Bind the fixture knowledge base to an assistant.',
      'Ask a question whose answer exists only in the fixture.',
      'Inspect the knowledge query, final answer, citation, and citation detail.'
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
    suite: 'suite-3',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    requiredCapabilities: ['npx'],
    steps: [
      'Create the platform-specific stdio configuration for @modelcontextprotocol/server-everything.',
      'Verify connection and the get-sum and echo tools, then enable it for the test assistant.',
      'Require get-sum to calculate 31415 + 27182 and inspect the tool call before restarting.'
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
    suite: 'suite-4',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Ask the default Cherry Assistant to research Cherry Studio and create agent-workspace/cherry-regression-31415.pptx with the exact title Cherry Regression 31415 and exactly three slides.',
      'Allow search and file tools, wait for completion, and open or preview the output.'
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
    suite: 'suite-4',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Import the prepared folder containing SKILL.md into Skill management.',
      'Bind it to an Agent and run the deterministic task defined by the fixture Skill.'
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
    suite: 'suite-4',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Create Cherry Regression Claude Agent 31415 with a compatible model, prompt, permission mode, Skill, and test working directory.',
      'Write AGENT_FILE_TASK_PASS to agent-workspace/claude-agent-result.txt, open its output, and restart.'
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
    suite: 'suite-4',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Create a Pi Agent with a compatible model and the shared deterministic file task.',
      'After tool approval, write AGENT_FILE_TASK_PASS to agent-workspace/pi-agent-result.txt and open it.'
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
    suite: 'suite-4',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Create a DeepSeek Harness Agent with a compatible model and the shared deterministic file task.',
      'After tool approval, write AGENT_FILE_TASK_PASS to agent-workspace/dsh-agent-result.txt and open it.'
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
    suite: 'suite-5',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Choose the configured CherryIN Gemini image model and submit the fixed image prompt.',
      'Wait for a visible image, switch modules and return, then download or open it.'
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
    suite: 'suite-5',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Choose the configured CherryIN Image 2 model and submit the same fixed cherry robot image prompt.',
      'Wait for a visible image and verify the retained file and history.'
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
    suite: 'suite-5',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Translate the fixed fixture text containing a proper noun, number, and unique marker.',
      'Open translation history after completion.'
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
    suite: 'suite-5',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    requiredCapabilities: ['systemFilePicker'],
    steps: [
      'Import the prepared PDF through the file-selection flow.',
      'Wait for extraction, translate it, and locate the fixture marker in the result.'
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
    suite: 'suite-6',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: ['Open a preset Mini App, wait for its main content, navigate away, and return.'],
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
    suite: 'suite-6',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: ['Open Code, select Claude Code, choose the test directory, and start its terminal.'],
    acceptance: ['The real process remains running in the selected working directory without a blocking setup error.'],
    evidence: [
      requirement('claude-code-process', 'process', 'Observe a live Claude Code process'),
      requirement('claude-code-directory', 'ui', 'Observe the selected working directory in the terminal'),
      screenshot('claude-code')
    ]
  },
  {
    id: 'CODE-02',
    title: '启动 Codex',
    suite: 'suite-6',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: ['Open Code, select Codex, choose the test directory, and start its terminal.'],
    acceptance: ['The real process remains running in the selected working directory without immediately exiting.'],
    evidence: [
      requirement('codex-process', 'process', 'Observe a live Codex process'),
      requirement('codex-directory', 'ui', 'Observe the selected working directory in the terminal'),
      screenshot('codex')
    ]
  },
  {
    id: 'CODE-03',
    title: '启动 OpenClaw',
    suite: 'suite-6',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: ['Configure OpenClaw, start its Gateway, open Dashboard, then stop Gateway.'],
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
    suite: 'suite-6',
    profile: 'authenticated',
    modes: ['branch', 'tag'],
    steps: [
      'Create a note titled Cherry Regression Note 31415 with body NOTE_AUTOSAVE_PASS_27182, wait for autosave, then navigate away and reopen it.',
      'Restart Cherry Studio and reopen the same note.'
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
