# Agent Note: Horizontal conversation tab status and message previews

Status: proposed

English | [中文](2026-11-11-tab-message-preview.zh.md)

## Problem

Horizontal conversation tabs show titles and avatars but do not expose the activity already visible in the conversation sidebar. Users switching among concurrent conversations cannot tell which one is running, needs attention, failed, or completed without opening it. A title-only tooltip also cannot answer where the conversation has reached.

## Proposal

### Scope and status ownership

Add status indicators and read-only message previews to horizontal Agent session and ordinary chat topic tabs, including pinned tabs. Keep sidebar hover content unchanged. Web, mini-app, settings, and other non-conversation tabs retain their existing behavior. A tab without a resolved conversation identity must not inherit the previously visited conversation's state.

Reuse the sidebar's status semantics, labels, colors, and completion acknowledgement. The current Agent sidebar resolves pending approval first, then a live execution, then error, then an unseen completion. Do not create a competing tab-specific priority or unread flag. Share the derivation where necessary without changing sidebar behavior. Approval anchors remain authoritative even when the stream is live or has ended; question requests use their actual unresolved interaction records, never inferred message text or a loading flag. A missing question-state capability must be addressed at its owning interaction boundary before adding a visual guess.

Keep the avatar, title, selected surface, and close control stable. Use one reserved status position on ordinary tabs. Pinned tabs use a 44 × 30 px rounded rectangle with a 16 px avatar, a 4 px gap, and a separate 10 px status slot. Reserve that slot while idle so state changes do not shift the layout; use the existing neutral selected surface. Adapt the sidebar status presentation to the available space without inventing different meanings. Selected tabs retain ongoing activity and attention indicators. Idle, acknowledged completion, and user-stopped execution need no persistent marker. Merely hovering or focusing never acknowledges a completion; entering the conversation uses its existing acknowledgement path.

### Preview content

Use the existing message presentation vocabulary rather than generating a separate summary. Reuse the message list’s user bubble, avatar layout, author header, font, font size, and message-style preference. Omit the duplicate conversation title and standalone status header; status remains on the tab. Show a bounded message fragment and a small open-conversation action without a full-width footer bar. Start visual validation at approximately 400 px wide and 360 px maximum height; constrain it to the viewport and allow short content to shrink. These are feature composition targets, not new design-system tokens.

For ordinary activity, show the latest user question and latest assistant reply, preserving the latest reply tail when bounded. Long user messages initially show three visual lines with an expand/collapse control; expansion stays bounded and does not activate the tab. Live text and tool activity update while the card is open. For pending user interaction, show the unresolved request instead of the latest tail. If several requests remain, show the earliest unresolved request in conversation order. Once resolved, select the next unresolved request or return to the latest messages. An error shows the actual failure and nearby context; a stopped turn shows its latest fragment. Distinguish loading, empty conversation, and unavailable preview.

Use read-only message rendering: preserve role labels, Markdown, and recognizable tool presentation; omit edit, copy, retry, branch, approval, answer, and composer controls. Questions show plain-text options rather than disabled-looking buttons. Tool details remain collapsed; oversized code and media are clipped or bounded, with no internal scrolling or autoplay. The card itself does not scroll. Indicate omitted content without implying that a clipped message is complete. No model, token, or directory inventory is added to this card.

### Interaction

Open an inactive conversation tab's preview after about 500 ms of pointer dwell. Moving into the card keeps it open; leaving both closes it after a short grace period. Only one card is open. Keyboard focus can reveal the same information and Escape dismisses it. Dragging, closing a tab, opening its context menu, switching its conversation identity, or activating the tab dismisses the preview. Do not preview the currently active tab or duplicate the native title tooltip.

The open-conversation action activates that exact existing tab, without creating another conversation tab. If it previews an unresolved request, use the existing message-location flow to locate its anchor after activation. If the request resolves before the click, open the conversation normally rather than acting on stale content. No approval, answer, login, retry, or other business action runs inside the preview. Ordinary tab selection, close, pin, keyboard shortcuts, and drag behavior remain intact.

### Implementation boundaries

The tab shell owns placement and hover lifetime; conversation identity, status, and messages remain owned by their existing domains. Observe lightweight status independently of whether the tab page is mounted or retained by the LRU. Load bounded message data only for the opened preview, using existing history queries and live projections. Unsubscribe when closed and reject results belonging to a previous identity. Do not mount a full chat page, initiate runtime work, acknowledge messages, or persist a copied stream status to obtain a preview.

Reuse the shared message presentation boundary with an explicit read-only capability when required. Hiding interactive controls with CSS alone is insufficient. Use `@cherrystudio/ui` primitives, semantic design tokens, localized strings, accessible names, and reduced-motion behavior. Keep current sidebar hover cards separate from this new horizontal-tab composition.

### Delivery and verification

Publish this bilingual Spec first. After an explicit human Approval on its current head, implement one dependent layer covering all acceptance criteria. Keep the note proposed until every criterion has actual evidence. Start with focused renderer tests for status mapping, preview content selection, interaction safety, navigation, and affected sidebar/tab consumers; then validate the real Electron hover and streaming behavior in both themes. Do not run a full local test suite by default.

On 2026-11-11, the user explicitly instructed implementation without waiting for approval. That instruction authorizes the dependent implementation layer; it does not replace verification evidence or mark this note implemented.

## Alternatives considered

- A separate tab status taxonomy would drift from the sidebar; reuse its semantics instead.
- Reusing the sidebar's metadata hover card would not show message progress; keep the horizontal preview distinct.
- A scrollable mini-conversation or direct approval controls would turn a glance into a second interaction surface; open the real conversation for reading and decisions.
- AI-generated summaries or mounting a complete chat page would add cost or side effects without improving the requested preview; reuse bounded message presentation and data.

## Acceptance criteria

- AC1 — Ordinary and pinned conversation tabs match sidebar status semantics and completion acknowledgement, including live approval anchors and background tabs; non-conversation tabs and sidebar hover content retain their behavior. (verification: renderer)
- AC2 — A preview displays the latest message fragment or earliest unresolved interaction; live updates, resolved requests, errors, stopped turns, loading, empty, and unavailable data never show another conversation's content. (verification: renderer)
- AC3 — The card and all nested message content remain bounded and non-scrollable, expose no business controls or autoplay, and opening or focusing them neither acknowledges completion nor initiates execution. (verification: renderer)
- AC4 — Preview activation selects the existing tab and locates a still-pending request; a resolved request falls back to normal activation, while tab close, pin, shortcuts, and drag retain their contracts. (verification: renderer)
- AC5 — Real Electron interaction confirms hover delay, pointer transfer, dismissal, keyboard access, reduced motion, viewport constraints, pinned tabs, and live background updates in light and dark themes. (verification: Electron)
- AC6 — The bilingual Spec, affected reference documentation, and localized UI copy stay aligned with the delivered behavior, with scoped checks and actual evidence recorded before the note moves to implemented. (verification: docs gate)

## Risks

The sidebar status component currently mixes meaning with row-specific positioning and hover-action behavior; reuse must not import those layout rules into the tab strip or change the sidebar. Message components can contain active tool controls, media, and expensive renderers; read-only capability and bounded loading must be enforced at their owners. LRU eviction, delayed history queries, and interaction resolution can race with hover or navigation; conversation identity and request anchors must remain authoritative. Large content may lose useful context when clipped, which is an accepted cost of a glance-only preview; complete content remains available in the conversation.
