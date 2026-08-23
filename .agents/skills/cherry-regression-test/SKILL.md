---
name: cherry-regression-test
description: Run Cherry Studio critical-path system regression tasks through the repository-owned CI driver. Use for full regression, release acceptance, development-branch system validation, or a named cherry-regression-test task on GitHub-hosted macOS and Windows runners.
---

# Cherry Regression Test

Use this skill only with the `cherry-regression` MCP server supplied by the
`Cherry Regression Test` workflow. The driver owns an isolated Electron
instance, clean and authenticated profiles, fixtures, process lifecycle, and
evidence files. Do not start, stop, or inspect Electron through Bash or generic
desktop tools.

## Execute the assigned task

1. Call `get-run-context`. Work only on the returned task and its cases, in
   listed order. Skip cases already marked `not_applicable` or complete.
2. Call `begin-case`. If it returns `blocked`, do not simulate the missing
   capability and move to the next case.
3. Follow the case steps against the real app. Inspect before interacting and
   prefer role, label, placeholder, or visible text locators. Use CSS only when
   the accessible surface cannot identify the control. Locator fields combine:
   use `role` with `name` or `text` to identify one control. Never inspect
   `css: "*"`; inspect the body once if no specific control is visible yet.
4. Supply configured values only through `configRef`; locators may use
   `nameConfigRef` or `textConfigRef`. Never request, reveal, copy, or type a
   credential or API key as a literal value.
5. For the CherryIN login case, choose `Set up later` if onboarding is visible,
   open Settings > Model Provider > CherryIN, and call `authenticate-cherryin`
   exactly once after `Authorize with CherryIN` is visible. If the first body
   inspection after `begin-case` contains only an image, wait 10 seconds once,
   then inspect the body once; do not probe controls while the splash is shown.
   If authentication returns an error, do not retry it; finish the case as
   failed. Do not search Cherry Studio or an external browser for account and
   password fields. Record identity with `text: Logged in via OAuth` and
   `exact: true`.

   After login, follow the remaining M-01 steps literally. Open
   `Get model list`, fill its `Search models` textbox with
   `configRef: cherryInChatModel`,
   inspect `textConfigRef: cherryInChatModel` with `exact: true`, then click the
   first `role: button`, `name: Add`, `exact: true` result. Do not inspect a
   non-exact `Add`, clear the filter, scroll the list, select a fallback, or use
   `Add all models`. Call `action: press`, `key: Escape` against the search
   textbox once. Open `Model Check` by exact button name, click
   `Check all models`, click `Start`,
   wait 10 seconds, and record the persistent exact `Passed` text. The dialog has
   already closed when that status is visible; do not click `Close`.

   Click the exact `Back` button to return to Chat; do not search for a Chat
   button inside Settings. Click `role: button`, `name: Selected models`,
   `exact: true` (the visible button text is the current model), fill
   `testId: model-selector-search` with `configRef: cherryInChatModel`, and
   click the first `role: option` result. The selector closes after selection,
   so do not press Escape. Fill `css: [contenteditable='true']` with the literal
   prompt `Reply with exactly CHERRYIN_CHAT_PASS and nothing else.`, click the
   exact `Send` button, wait 10 seconds, and record the exact
   `CHERRYIN_CHAT_PASS` response. Capture `cherryin-chat` immediately, then
   restart. After a one-time splash wait if needed, open Settings > Model
   Provider and record `cherryin-restart` against the exact
   `Logged in via OAuth` text.
6. For M-02, open `Add Provider`. Fill exact `role: textbox` locators named
   `Provider Name*`, `API Key`, and `Anthropic` with the declared provider name,
   `configRef: customProviderApiKey`, and `configRef: customProviderBaseUrl`,
   respectively. Set `exact: true` on all three. Before submitting, record
   `custom-provider-redacted` against the exact API Key textbox while it still
   contains the configured value and remains a password input. Click the exact
   `Add` button. On the saved provider, click its only `role: switch` to enable
   it before configuring models. Click the exact `Add Model` button, fill the exact `Model ID` textbox with
   `configRef: customProviderChatModel`, then call `action: press`, `key: Enter`
   against that textbox. Do not use `Get model list`.

   Open `Add Model` again, fill the exact `Model ID` textbox with
   `configRef: customProviderEmbeddingModel`, click the exact `More Settings`
   button, click the exact `Embedding` button in the `Model Type` group, then
   press Enter against the `Model ID` textbox. Never type a `configRef` name as
   literal field content.

   Record `custom-provider-saved` against `role: main`, which contains the
   provider name and both exact model IDs. Run `Model Check` for the selected
   chat model, click `Start`, wait 10 seconds, and record the persistent exact `Passed` status. Do not
   click `Close` afterward. Click the exact `Back` button, then select the chat model
   through exact button name `Selected models`; fill
   `testId: model-selector-search` with `configRef: customProviderChatModel`
   and click the first `role: option`. Fill `css: [contenteditable='true']` with
   `Reply with exactly CUSTOM_PROVIDER_CHAT_PASS and nothing else.`, click the
   exact `Send` button, wait 10 seconds, and record the exact response. Capture
   `custom-provider-chat` before restarting and verifying provider persistence.
7. For C-01, click the exact `Back` button first if Settings is still open.
   Click the exact `Add Assistant` button, then the exact `New Assistant`
   option. Fill the exact `Name` and `Description` textboxes once; a successful
   fill does not require a body-text recheck. Click the button labelled
   `Avatar`, then the exact `star-struck` button. Open the exact `Model` button,
   fill `testId: model-selector-search` with
   `configRef: customProviderChatModel`, and click the first `role: option`
   result. The selector closes after selection, so do not press Escape.

   Click the exact `Next` button. Fill the `role: textbox` whose exact name is
   `Enter instructions for the assistant, such as response style, role, or background context`
   with `You must always include the exact phrase ASSISTANT_PROMPT_PASS in every response you give, no matter what the user asks.`
   Click exact `Next`, then exact `Create`. Record `assistant-saved` against the
   assistant name. Fill `css: [contenteditable='true']` with
   `In one sentence, what is two plus two?`, click exact `Send`, wait 10 seconds,
   and record the visible `ASSISTANT_PROMPT_PASS` response. Capture
   `assistant-chat` immediately, then restart. After a one-time splash wait if
   needed, reopen the named assistant, verify the response remains in its chat
   history, and record `assistant-restart` against a main region containing the
   assistant name. Do not repeat field fills, probe unsupported `type` or
   `press-escape` actions, or search for legacy Ant Design selectors.
8. For C-02, open Settings > Default Model. Click the first model button in the
   `Default Assistant Model` row, filter `testId: model-selector-search` with
   `configRef: customProviderChatModel`, and click the first `role: option`.
   Open Quick Assistant and click its only switch while the feature is disabled.
   Leave `Default Model` selected under `Usage Method`.

   Open Keyboard Shortcuts, click the exact `Search` button, fill the
   `Search shortcuts...` textbox with `Quick Assistant`, then click the only
   visible switch to enable the existing Cmd/Ctrl+E binding. Do not edit the
   binding. Call `open-external-text` with the returned selection fixture path,
   then call `hotkey` with `Meta` + lowercase `e` on macOS or `Control` +
   lowercase `e` on Windows. Uppercase `E`, `Ctrl`, and `Command` are invalid
   system-action keys.

   In scope `quick-assistant`, record `quick-external-invocation` against the
   exact `Answer this question` text. Fill its only `role: textbox` with
   `Reply with exactly QUICK_ASSISTANT_PASS and nothing else.`, press Enter,
   wait 10 seconds, record the exact response, and capture `quick-assistant`.
   Press Escape once to return from the result view, then call system-action
   `press-escape` to close the home view and immediately record
   `quick-escape-close` without a locator. Restart the app, open the external
   fixture again, invoke the same platform hotkey, resend the same prompt, and
   record `quick-restart` against the response in scope `quick-assistant`.
9. For K-01, return from Settings if needed and open the exact `Knowledge Base`
   button. Click exact `Create Knowledge Base`, fill the `Name` textbox with
   `Cherry Regression Knowledge 31415`, and open the exact `Embedding Model`
   button. Fill `testId: model-selector-search` with
   `configRef: customProviderEmbeddingModel` and click the first `role: option`.
   Click exact `Create` once and wait for the knowledge page.

   Click the exact `Folder` data-source button and immediately call
   `system-action` `native-file-picker` with the returned `knowledgeDirectory`.
   This imports all three fixtures in one operation. Wait for processing, open
   the imported `knowledge` folder, and record `knowledge-file-status` against
   the main region only after `ground-truth.txt`, `context.md`, `reference.html`,
   and `Ready` are visible. Do not import the three files separately.

   Click exact `Recall Test`, fill the exact `Enter test query...` textbox with
   `What is the regression knowledge answer?`, click exact `Search`, and wait
   for the result. Record `knowledge-recall` against the visible
   `CHERRY_KNOWLEDGE_58597` result and capture `knowledge-recall-screen`.
   Restart, reopen Knowledge Base and `Cherry Regression Knowledge 31415`, then
   record `knowledge-restart` against its visible name.
10. For C-03, open Settings > Selection Assistant and click its only switch
   while disabled. On Windows, select the exact radio named `Ctrl Key`; leave
   the default `Selection` trigger on macOS. Return with exact `Back`, then call
   `open-external-text` with the returned selection fixture. On Windows only,
   call `hotkey` with the single key `Control`; the driver holds it long enough
   for Ctrl Key mode. Do not invent Alt/Space or a selection shortcut.

   In scope `selection-assistant`, record `selection-actions` against `css: body`
   while the initial toolbar still shows Translate, Explain, Summarize, Search,
   and Copy. Then click exact `Explain`. In the action window, click exact
   `Show Original`, wait 10 seconds, and record both `selection-source` and
   `selection-model-response` against `css: body` only after
   `SELECTION_ASSISTANT_PASS` is visible. Capture `selection-assistant`, record
   `selection-source-preserved` using the exact fixture path, and call
   `press-escape` once to close the action window.
11. For K-02, return to Chat, select `Cherry Regression Assistant 31415`, and
   click the exact `Edit Assistant: Cherry Regression Assistant 31415` button.
   Open the exact `Knowledge` tab, click `Add knowledge base`, and select the
   exact `Cherry Regression Knowledge 31415` item. The selection autosaves;
   close the editor with its exact `Close` button. In that assistant's current
   chat, send `Use the linked knowledge base to answer: What is the regression
   knowledge answer? Include the exact answer marker and cite the source file.`
   Wait 15 seconds once. After `CHERRY_KNOWLEDGE_58597` appears, record both
   `knowledge-query` and `knowledge-answer` against the main region. Click the
   visible `ground-truth.txt` citation, record `knowledge-citation` against the
   opened citation detail, and capture `knowledge-answer-screen`. Do not create
   another knowledge base or another assistant.
12. For MCP-01, open Settings > MCP, click exact `Add`, then exact
   `Quick Create`. Fill `Name*` with `everything`, `Command*` with `npx`, and
   `Arguments` with two actual lines: `-y`, newline,
   `@modelcontextprotocol/server-everything`. Never use the literal characters
   `\n` or put both arguments on one line. Click exact `Add`, enable the exact
   `everything` switch, and wait 15 seconds once. Open the `everything STDIO`
   server, select exact `Tools`, and record `everything-tools` against the view
   containing both `get-sum` and `echo`.

   Return to Chat and edit `Cherry Regression Assistant 31415`. Open its exact
   `MCP` tab, select exact `Manual` in the `MCP Mode` group, enable the exact
   `everything` switch, and close the editor. Send `You must call the get-sum
   tool with a=31415 and b=27182, then reply with exactly 58597.` Wait 15 seconds
   once, then record `everything-tool-call` and `everything-result` against the
   main conversation and capture `everything-mcp`. Restart, reopen Settings >
   MCP, wait 15 seconds once, open the `everything` server, and record
   `everything-restart` only while that server shows `Connected`.
13. For A-01, click exact `Back` if Settings is open, then exact `Work`, and
   select the built-in Agent `Cherry Assistant` there, not the Chat assistant.
   If its model button says `Select Model`, filter `model-selector-search` with
   `configRef: cherryInChatModel` and select the first option. Set the work
   directory from `No work directory` > `Add new work directory` with the
   returned `agentWorkspace`; if `agent-workspace` is already an option, select
   it directly.

   Send: `Use a real web search about Cherry Studio, then use file or shell
   tools to create a real PowerPoint file named cherry-regression-31415.pptx in
   the current working directory. Its exact title must be Cherry Regression
   31415 and it must contain exactly three slides. Do not merely describe the
   deck.` Approve a real tool request if one appears and wait up to 30 seconds
   once. Record `ppt-search-tool` only against a visible search activity card,
   record `ppt-file` as file evidence without supplying a path, click the
   generated `cherry-regression-31415.pptx` link or preview, record `ppt-opened`
   after the exact title renders, and capture `ppt-result`.
14. For A-02, open Settings > Skills, click exact `Add Skill` > `Local import`
   > `Install from directory`, then immediately use `native-file-picker` with
   the returned `skillDirectory`. Enable the exact global switch for
   `cherry-regression-fixture` if it is disabled and record `skill-imported`.
   Return to exact `Work`, select the built-in Agent `Cherry Assistant`, click
   its composer `Skills` button, and enable `cherry-regression-fixture` there.
   Send `What is the regression marker? Follow the enabled fixture skill
   exactly.` Wait 10 seconds once, record `skill-behavior` against the exact
   `SKILL_IMPORT_PASS` response, and capture `skill-result`. Skills do not run
   in the Chat assistant, so never navigate to Chat for this case.
15. For Agent runtime cases A-03 through A-05, reuse `agent-workspace` whenever
   its directory option exists. Otherwise click `No work directory` >
   `Add new work directory` and immediately call `native-file-picker` with the
   returned `agentWorkspace`. After the picker closes, verify the visible
   directory label is `agent-workspace`. File evidence has a fixed contract;
   call it without a path so Windows separators cannot select another file.

   For A-03, create `Cherry Regression Claude Agent 31415`, choose exact
   `Advanced: Claude Agent`, filter its Model selector with
   `configRef: cherryInChatModel`, and keep the default approval permission.
   Click exact `Next` through System prompt, Skills, and Knowledge, then exact
   `Create`; do not import a Skill. Set `agent-workspace`, record
   `claude-runtime`, and send `Write the text AGENT_FILE_TASK_PASS to a file
   named claude-agent-result.txt in the current working directory.` If `Allow`
   appears, click it once. Wait 15 seconds once, record `claude-file` without a
   path, capture `claude-agent`, restart, reopen the named Agent, and record
   `claude-restart`.

   For A-04, create `Pi Regression Agent`, choose exact `Fast: Pi`, filter the
   model selector with `configRef: cherryInChatModel`, keep `Ask Before Acting`,
   click exact `Next` three times and `Create`, then set `agent-workspace`.
   Record `pi-runtime`, send the same file instruction for
   `pi-agent-result.txt`, record `pi-approval` while `Allow` is visible, click
   `Allow`, wait 10 seconds once, record `pi-file` without a path, and capture
   `pi-agent`.

   For A-05, create `DeepSeek Harness Agent`, choose exact `DeepSeek Harness`,
   filter the model selector with `configRef: cherryInChatModel`, click exact
   `Next` three times and `Create`, then set `agent-workspace`. Record
   `dsh-runtime`, send the same file instruction for `dsh-agent-result.txt`,
   record `dsh-approval` while `Allow` is visible, click `Allow`, wait 10
   seconds once, record `dsh-file` without a path, and capture `dsh-agent`.
16. For P-01, open Settings > Model Provider > CherryIN > `Get model list`,
   select exact `Image`, fill exact `Search models` with
   `configRef: cherryInGeminiImageModel`, inspect the exact configured model,
   and click the first exact `Add` button. Press Escape against the search box
   once. Return with exact `Back`, open exact `Paintings`, click `Select Model`,
   filter `model-selector-search` with the same config ref, and choose the first
   option. Fill the composer with the returned exact `imagePrompt`, click exact
   `Send`, and wait 30 seconds once. Record `gemini-image-visible` against
   `role: main` only after the prompt, selected model, and `1 / 1` are visible.

   Open the context menu on `testId: artboard-image-transform` with interaction
   action `context-menu`, click exact menu item `Save As`, and immediately call
   `native-save-picker` with the returned `geminiImageFile`. Record
   `gemini-image-file` without a path. Navigate to Chat and back to Paintings,
   record `gemini-image-history` against the main region containing the exact
   prompt, and capture `gemini-image`.

   For P-02, click exact `New Image`, add `configRef: cherryInImage2Model` from
   the CherryIN image model list using the same filtered flow, return to
   Paintings, select that model, and send the same exact prompt. After `1 / 1`
   appears, record `image2-visible`, open the generated image context menu,
   choose exact `Save As`, call `native-save-picker` with `image2File`, and
   record `image2-file` without a path. Navigate away and back, record
   `image2-history`, and capture `image2-image`.
17. For T-01, open exact `Translation`. The selected-model icon button is
   `css: [data-ui='translate.view'] button:has(+ button[aria-label='Translation History'])`;
   click it, filter `model-selector-search` with
   `configRef: customProviderChatModel`, and select the first option. Fill
   `css: [data-ui='translate.input'] textarea` with the returned exact
   translation marker, click exact `Translate`, and wait 15 seconds once.
   Record `text-translation` against `css: [data-ui='translate.output']` only
   after the non-empty translation retains Neptune, 27182, and
   TRANSLATION_MARKER. Click exact `Translation History`, record
   `translation-history` against the visible history, and capture
   `text-translation-screen`.

   For T-02, close history, click exact `Clear`, then click exact
   `Drop or click to upload image/document` and immediately call
   `native-file-picker` with `pdfFile`. Wait 15 seconds once and record
   `pdf-imported` only after `PDF_TRANSLATION_MARKER_314159` is visible. Click
   exact `Translate`, wait 30 seconds once, record `pdf-translation` against the
   region containing that marker, and capture `pdf-translation-screen`.
18. For APP-01, click exact `Back` if Settings is open, then exact `Launchpad`,
   exact `MiniApp`, and exact `ChatGPT`. Wait 10 seconds once and record
   `mini-app-loaded` against the main view containing the ChatGPT mini-app
   toolbar or loaded content. Click exact `Chat`, then exact `Apps`, then exact
   `ChatGPT`; record `mini-app-returned` after the same mini-app is usable and
   capture `mini-app`. Do not search the fixed sidebar for a Mini App entry.
19. For CODE-01 and CODE-02, click exact `Launchpad`, then exact `Code`. Select
   exact `Claude Code` or `OpenAI Codex` in the Code navigation. The workflow
   has already installed both CLIs; do not click Install or Retry. For Claude
   Code, configure `Cherry Regression Custom Provider 31415`; for Codex,
   configure `Unified Gateway`. In the provider's exact `Configure` dialog,
   click `Select a model`, filter `model-selector-search` with
   `configRef: customProviderChatModel`, select the first option, click exact
   `Save`, then exact `Enable` for that provider.

   Click exact `Launch`, then exact `Select Folder`, and immediately use
   `native-file-picker` with `agentWorkspace`. Before submitting the dialog,
   record `claude-code-directory` or `codex-directory` against its visible
   `agent-workspace` value. Click the dialog's exact `Launch`, wait 5 seconds,
   record the corresponding process evidence, and capture `claude-code` or
   `codex`. Do not look for Code in the fixed sidebar and do not inspect the
   external terminal through CDP.
20. For CODE-03, click exact `Launchpad` > `Code` > `OpenClaw`. The workflow
   has already installed OpenClaw; do not click Install or Retry. Configure
   `Cherry Regression Custom Provider 31415`, select
   `configRef: customProviderChatModel`, click exact `Save`, then exact
   `Enable`. Click exact `Launch` and wait 15 seconds once; this starts the real
   Gateway and opens its Dashboard. Record `openclaw-gateway` as process
   evidence. Inspect `css: body` in `scope: any` once, identify a
   dashboard-specific connected text, record `openclaw-dashboard` there, and
   capture `openclaw`. Return to the main Code page, click exact `Stop`, wait 5
   seconds, and record `openclaw-stopped` as process evidence.
21. For N-01, click exact `Launchpad` > `Notes`. Click
   `css: [data-ui='notes.navigation'] svg.lucide-file-plus-2` once. Fill the
   only `css: [data-ui='notes.view'] input` with
   `Cherry Regression Note 31415`, then press Enter against it. Fill
   `css: [data-ui='notes.editor'] [contenteditable='true']` with
   `NOTE_AUTOSAVE_PASS_27182` and wait 3 seconds once. Navigate to Chat, return
   through Launchpad > Notes, click exact `Cherry Regression Note 31415`, and
   record `note-reopened` against `css: [data-ui='notes.view']`. Restart,
   return through Launchpad > Notes, reopen the exact note, record
   `note-restart` against the same view, and capture `note`.
22. Use `system-action` only for the case's external shortcut, external text,
   native open picker, or native save picker step. Use fixture and workspace
   paths returned by `get-run-context`.
23. For persistence checks, call `restart-app`, reopen the relevant UI, then
   record the declared `restart` evidence.
24. Record every evidence item declared by the case. UI and restart evidence
   must assert meaningful visible text; file and process evidence must use the
   real output or owned process. Navigate away from credential fields and
   account details before taking screenshots. A narrative claim is never evidence.
25. If an observation fails, inspect the current state and retry only after a
   real corrective interaction. Otherwise complete the case as `failed`. Use
   `blocked` only for an unavailable external capability or prerequisite, not
   for an application defect.
26. Call `complete-case` exactly once with the actual result. `passed` is valid
   only after all declared machine evidence passes.

## Keep execution bounded

- Do not repeat an equivalent failed inspection or interaction more than once.
  After one genuinely different corrective attempt, finish the case as
  `failed`, or `blocked` only when an external prerequisite is unavailable.
- Prefer one scoped inspection over several broad inspections. Do not explore
  unrelated navigation after the required control or feature is proven absent.
- Reserve the final two tool calls for `complete-case` and the final
  `get-run-context`. Once every applicable case is terminal, respond immediately
  without calling another tool.

At the end, call `get-run-context` again and make sure every applicable case in
the assigned task is `passed`, `failed`, or `blocked`. Do not modify source
files, test definitions, fixtures, run state, or reports.
