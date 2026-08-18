---
description: Entry point for chat domain references covering renderer chat UI structure, rich clipboard, and the message tree
sources:
  - src/renderer/components/chat
  - src/renderer/components/composer
  - src/main/data/services/MessageService.ts
---

# Chat Reference

This is the entry point for the chat domain in Cherry Studio v2 — the renderer chat UI
under `src/renderer/components/chat`, the composer it pairs with, and the main-process
message-tree model the chat surfaces render.

| Document | What it covers |
|---|---|
| [Chat Adapters](./adapters.md) | Planned contract layer projecting business entities into stable UI shapes, plus pane/action registries and render-stability rules |
| [Composer Rich Clipboard](./composer-rich-clipboard.md) | Private clipboard format that preserves composer tokens across copy/paste, its restore rules, and ownership boundaries |
| [Chat UI Design & Conventions](./conventions.md) | Responsibility split of the chat UI (presentation / view state / contracts / content / orchestration) and its coding conventions |
| [Message Tree](./message-tree.md) | The topic message-tree model: adjacency list, virtual root, sibling groups, invariants, delete semantics, consumer contract |
