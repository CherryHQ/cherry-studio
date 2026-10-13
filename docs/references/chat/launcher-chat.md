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
its model using Quick Assistant's existing model selector. In **Settings → Quick Assistant**,
choose the default floating chat mode: Saved or Temporary. New ordinary Quick Assistant
conversations and launcher URLs without an explicit mode follow this setting. The badge
shows the selected mode even before sending; saved chats enter history on their first send.
Existing conversations retain their mode when the default changes.

**Settings → Shortcuts** has separate configurable global commands for **New temporary chat**
and **New saved chat**. These override the default mode and work with Main in the background.
Temporary defaults to `Ctrl/Cmd+Shift+N`; the saved shortcut starts unassigned. Configure either
using the direct shortcut links in Quick Assistant settings. Choose a binding that your desktop
does not reserve. Temporary chats stay
out of normal history until **Save and open in Cherry Studio** or **Minimize** is selected.
The floating model picker starts with the configured Quick Assistant model (or its
assistant's model), falling back to the default chat model when appropriate. A local
selection applies to subsequent turns. The shared reasoning control offers only the
selected model's supported efforts, and restores provider Default on an incompatible switch.
The composer and floating message bubbles use native automatic text direction. Hebrew
questions read right to left, with the question mark at the visual left; English remains LTR.
No punctuation or directional control characters are inserted into stored messages.
Replacing a temporary conversation with messages asks before discarding it.
Floating chats stay visible when they lose focus. **Stop** cancels generation in
Chat, Summary, and Explanation. **Esc** hides the window without clearing the conversation, including during generation.
**C**, outside text fields, copies the latest answer; the footer also offers Copy.

Saved floating conversations offer **Open in Cherry Studio** and **Delete**.
Delete uses Cherry's existing Recycle Bin archive command.
**Minimize** saves the conversation, hides the floating window, and leaves it available
in the main app's chat history without opening the main window. For temporary chats,
Minimize waits until generation finishes before enabling storage conversion.
**X** asks before deleting the conversation and hiding the window; Cancel keeps it open.
The launcher works while Cherry runs in the background with its main window closed,
including after the main window has been destroyed. Saved follow-up turns continue
the active conversation branch, including after a temporary chat is saved.

## Launcher protocol

A launcher can open the registered Cherry Studio URL handler:

```text
cherrystudio://chat/new?prompt=where+is+paris&temporary=false&submit=true
```

Encode the prompt with `URLSearchParams` or an equivalent URL encoder. The
handler accepts at most 16,000 prompt characters and rejects duplicate or
unknown parameters. `temporary` and `submit` accept only `true` or `false`.
Omitted `temporary` uses the user's default floating chat mode (initially Saved);
omitted `submit` defaults to `false`. Explicit `temporary=true` or `temporary=false`
overrides that preference.
Explicit submission sends immediately using the configured Quick Assistant
model or assistant. Without a configured model, the prompt remains ready to send. Selecting a model
later does not automatically submit that retained draft; use Send explicitly.
The handler does not change the Quick Assistant enabled preference.

The floating window opens in the center of the cursor's display, within its work
area. Wayland compositors may override requested window positioning.

A Vicinae no-view extension can implement `!chat` by opening this URL with
`submit=true` and omitting `temporary` to follow the user preference. Separate saved
and temporary commands set `temporary=false` and `temporary=true` respectively.
Launcher conversations are saved before their first message is sent; if saving
fails, Cherry keeps the prompt and shows the error without sending it.

## Linux and Wayland

The Linux floating window uses an opaque background and keeps its custom frame:
Electron does not support resizing transparent windows. Drag the frame outside
its buttons to move it; use its outer resize boundary to resize. Wayland
compositors control placement and activation, so requested centering is not
guaranteed. On GNOME, Super + left-drag moves a window; Super + middle-drag resizes it.

Native global shortcuts require a desktop backend exposing the Global Shortcuts
portal and, on GNOME, user consent. In a Flatpak, Cherry uses `FLATPAK_ID` as its
desktop identity so the portal can match the installed desktop entry. Startup
preserves launcher-supplied Chromium features alongside its shortcut portal flag.

To distinguish shortcut registration from launcher delivery, keep Main open and
run this on the PC (for the private `rtl` Flatpak branch):

```sh
flatpak run --user --branch=rtl com.cherry_ai.CherryStudio 'cherrystudio://chat/new?temporary=true&submit=false'
gdbus call --session --dest org.freedesktop.portal.Desktop --object-path /org/freedesktop/portal/desktop --method org.freedesktop.DBus.Properties.Get org.freedesktop.portal.GlobalShortcuts version
```

If the URL works but the shortcut does not, verify **Settings → Shortcuts → New
temporary chat** is enabled and bound, accept any GNOME shortcut consent dialog,
and check your desktop's reserved bindings. A missing portal interface requires
a compatible desktop portal backend. A GNOME custom keyboard shortcut can also
run the `flatpak run` URL command above without relying on Cherry's global-key
registration.

For a diagnostic XWayland comparison, close Cherry completely first, then launch
once with `flatpak run --user --branch=rtl --socket=x11 --nosocket=wayland
com.cherry_ai.CherryStudio --ozone-platform=x11`. This does not persist a Flatpak
override. Test moving/resizing before opening a model request.

## Ownership and scope

The main process delivers each request to the Quick Assistant window through
WindowManager init data. The renderer acknowledges it to prevent a window reload
from replaying the prompt. A new request starts a new topic; the latest request
wins if multiple requests arrive before the renderer is ready.

Temporary topics use the existing `TemporaryChatService` and lease hook. Saving
promotes the topic to SQLite with the same ID. This floating text-chat feature
does not implement temporary agent sessions or a temporary sidebar section.
