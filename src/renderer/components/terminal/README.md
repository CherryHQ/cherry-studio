# Conversation terminal pane

`TerminalPane` lists this product conversation's persistent terminals and fresh shell executions. Running Bash calls can be promoted explicitly; pipe output remains read-only. The pane does not start a process merely by opening or refreshing a view. Closing the pane leaves its resources running.

`TerminalCanvas` draws window-bound cell frames from the authoritative Host Ghostty core. It has no VT parser or renderer-side WASM instance. Content and cursor/selection use separate Canvas layers; dirty rows render in animation frames. The real textarea handles keyboard input, paste and IME, with a bounded accessible viewport log. Canvas/key normalization derives from T3 Code revision `0a8aaa3ccb944dadb70054ae4ef2e29897b0db03`; see the [asset provenance and licenses](../../../../resources/terminal/ghostty/README.md).

Each view has its own scroll position, selection and attachment identity. Only an explicitly controlling view can resize or send input. Creating a user terminal includes that explicit control intent; passive attach/reopen does not. Control revision and geometry epoch travel with queued input. Stale submissions fail without automatic replay. Composition commits once, and a control/view change rejects the old composition.

Frames use compact style dictionaries, bounded chunks and an explicit baseline revision. Missing or stale frames reset presentation and request a baseline. Final screens can be served from Main after Host retirement; when unavailable, the pane shows the retained raw suffix. Visible viewport selection clears when its text changes rather than copying different output at stale coordinates. Links require an explicit modified click and resolve through the Host before the existing external-link policy.
