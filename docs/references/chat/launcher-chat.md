---
description: Launcher protocol and saved or temporary floating chat lifecycle
sources:
  - src/main/services/protocol/handlers/chat.ts
  - src/main/services/QuickAssistantService.ts
  - src/renderer/windows/quickAssistant/home/HomeWindow.tsx
  - src/shared/ipc/schemas/quickAssistant.ts
  - src/shared/utils/command/definitions.ts
---

# Launcher and Temporary Chats

Use the Temporary Chat action in the chat navbar or the configurable
`Ctrl/Cmd+Shift+N` shortcut to open a floating, in-memory conversation. Choose
its model using Quick Assistant's existing model selector. Temporary chats stay
out of normal history until **Save and open in Cherry Studio** or **Minimize** is selected.
The floating model picker starts with the configured Quick Assistant model (or its
assistant's model), falling back to the default chat model when appropriate. A local
selection applies to subsequent turns. The shared reasoning control offers only the
selected model's supported efforts, and restores provider Default on an incompatible switch.
Replacing a temporary conversation with messages asks before discarding it.
**Esc** hides the window without clearing the conversation, including during generation.
**C**, outside text fields, copies the latest answer; the footer also offers Copy.

Saved floating conversations offer **Open in Cherry Studio** and **Delete**.
Delete uses Cherry's existing Recycle Bin archive command.
**Minimize** saves the conversation, hides the floating window, and leaves it available
in the main app's chat history without opening the main window. For temporary chats,
Minimize waits until generation finishes before enabling storage conversion.
**X** asks before deleting the conversation and hiding the window; Cancel keeps it open.
The launcher works while Cherry runs in the background with its main window closed.

## Launcher protocol

A launcher can open the registered Cherry Studio URL handler:

```text
cherrystudio://chat/new?prompt=where+is+paris&temporary=false&submit=true
```

Encode the prompt with `URLSearchParams` or an equivalent URL encoder. The
handler accepts at most 16,000 prompt characters and rejects duplicate or
unknown parameters. `temporary` and `submit` accept only `true` or `false`.
Omitted `temporary` defaults to `false`; omitted `submit` defaults to `false`.
Explicit submission sends immediately using the configured Quick Assistant
model or assistant. Without a configured model, the prompt remains ready to send.
The handler does not change the Quick Assistant enabled preference.

The floating window opens in the center of the cursor's display, within its work
area. Wayland compositors may override requested window positioning.

A Vicinae no-view extension can implement `!chat` by opening this URL with
`temporary=false&submit=true`. A second command can set `temporary=true`.
Launcher conversations are saved before their first message is sent; if saving
fails, Cherry keeps the prompt and shows the error without sending it.

## Ownership and scope

The main process delivers each request to the Quick Assistant window through
WindowManager init data. The renderer acknowledges it to prevent a window reload
from replaying the prompt. A new request starts a new topic; the latest request
wins if multiple requests arrive before the renderer is ready.

Temporary topics use the existing `TemporaryChatService` and lease hook. Saving
promotes the topic to SQLite with the same ID. This floating text-chat feature
does not implement temporary agent sessions or a temporary sidebar section.
