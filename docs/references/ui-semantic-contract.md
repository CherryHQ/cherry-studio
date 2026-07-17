# UI Semantic Contract

Cherry Studio exposes app-owned HTML elements and public SVG boundaries through one machine-readable `data-ui`
attribute. It is the stable interface for user themes, end-to-end tests, inspectors, and controlled AI automation.
Internal classes, DOM ancestry, and unmarked SVG drawing primitives are not part of this contract.

## Token protocol

`data-ui` is an unordered set of whitespace-separated tokens. The compiler writes tokens in this canonical order:

```html
<article
  data-ui="chat.message part:message-content id:u3976699 scope:message:m_817 scope:topic:t_42 mode:fold state:assistant state:complete"
></article>
```

| Token | Meaning | Stability |
| --- | --- | --- |
| `chat.message` | Human-readable semantic role | Stable public grouping selector |
| `part:message-content` | Reusable component structure role | Stable public part selector |
| `id:u3976699` | Compact exact source node identity | Stable across builds; never reused after retirement |
| `scope:message:m_817` | Runtime instance identity | Stable for that business entity |
| `variant:bubble` | Visual/product variant | Changes when the variant changes |
| `mode:fold` | Active layout or behavior mode | Changes with the active mode |
| `state:complete` | Current state | Changes with runtime state |
| `scope:window:main` | Renderer window identity | Stable for that window type |

Use token matching (`~=`), never substring matching:

```css
/* Every chat message */
[data-ui~='chat.message'] {
  display: grid;
}

/* One message instance */
[data-ui~='chat.message'][data-ui~='scope:message:m_817'] {
  outline: 1px solid hotpink;
}

/* One reusable component part */
[data-ui~='part:dialog-content'] {
  border-radius: 8px;
}

/* One exact source node */
[data-ui~='id:u7b21d4a'] {
  display: none;
}
```

## Build-time contract

The pre-transform Vite plugin parses TSX/JSX with SWC and annotates every intrinsic HTML element plus each `svg` root
before the React compiler runs. Reusable component structure, including Cherry Studio's Radix/Shadcn primitives, is
represented by `part:*` tokens in the same attribute. Window HTML is annotated by the same plugin. Exact `id:*` tokens
belong only to intrinsic DOM source nodes. A semantic `data-ui` value passed through a component is merged with the
intrinsic node's part and exact ID, including across JSX prop spreads and Radix `asChild` slots.

SVG drawing internals such as `path`, `g`, `defs`, gradients, masks, filters, and shapes are implementation details by
default. They enter the public contract only when they carry `data-ui`, `data-testid`, `role`, or an event
handler. HTML descendants of `foreignObject` are annotated normally. This keeps icons themeable through their stable
`svg` boundary while avoiding thousands of fragile IDs for generated vector paths; a drawing part that genuinely needs
independent styling or testing can opt in explicitly.

Semantic inference uses, in order:

1. an explicit semantic ID passed to `uiTokens` or a static `data-ui` value;
2. `part:*`, `data-testid`, stable `id`/`name`/`type`, and event-handler names;
3. source domain, component name, and element role.

Visible text is never an identity input, so localization and copy changes cannot rename the contract. Line numbers,
timestamps, random values, class names, and build traversal order are also excluded.

The committed `ui-contract.registry.json` reconciles source nodes with their exact IDs. IDs survive formatting, display
text changes, and normal rebuilds. Registry sync matches nodes in this order: unchanged source anchor, Git-confirmed
file rename, then an unambiguous structural fallback — an ID follows a moved or edited node only when exactly one
removed and one added node share the same component, element, semantic attributes, and parent role, and an explicit
semantic ID does not contradict the previous one. Ambiguous candidates are never guessed: an unrelated replacement gets
a new ID, while the removed exact ID moves to a tombstone list and is never allocated again. Renaming a component or
wrapping a node in a new parent still changes its identity, so themes should target semantic and `part:` tokens first
and reserve `id:` for tests and single-node overrides.

After changing renderer markup, update and commit the registry:

```bash
pnpm ui:contract:sync
```

When a merge or rebase conflicts on `ui-contract.registry.json`, never resolve it by hand-editing the JSON. Accept
either side, re-run `pnpm ui:contract:sync` on the merged sources, and commit the regenerated file — reconciliation is
deterministic, so the rerun converges regardless of which side was kept.

Production builds and CI reject drift through `pnpm ui:contract:check`. Builds emit a deterministic, dictionary-packed
`ui-contract.json` asset. Its `columns` field describes each node tuple; the `sources`, `semantics`, `elements`, and
`components` dictionaries map tuple indexes back to readable metadata. Theme inspectors and AI tools should discover the
contract from this manifest instead of scraping implementation classes.

During source work, an agent or developer can resolve a semantic prefix without building the app:

```bash
pnpm ui:contract:query chat.message
```

The command returns exact IDs, element/component names, and relative source locations as JSON, and refuses to query a
stale registry.

## Runtime API

Use the curated runtime helpers for entity scopes and state. Do not concatenate free-form strings:

```tsx
import { uiTokens } from '@renderer/utils/uiContract'

<div
  data-ui={uiTokens('chat.message', {
    scopes: [`message:${message.id}`, `topic:${message.topicId}`],
    parts: ['message-content'],
    states: [message.role, message.status, selected && 'selected'],
    modes: ['fold']
  })}
/>
```

`uiTokens` validates the token grammar, removes duplicates, and serializes deterministically. `parseUiTokens` supports
inspectors. `uiSelector` creates exact CSS selectors. Playwright code can use `uiLocator(page, 'chat.message', options)`
from `tests/e2e/utils`.

Runtime scopes may contain durable business IDs already present in the renderer. Do not place secrets, prompt content,
credentials, or user-visible text in a token.

## Custom CSS across windows

Each window body exposes its window identity:

```html
<body data-ui="app.window id:u3976699 scope:window:main">
```

Custom CSS is inserted verbatim and unlayered after application styles, so it can use the full CSS surface—including
`:root`, `body`, top-level at-rules, and semantic `data-ui` selectors—without blanket `!important`. Every regular
renderer window subscribes to the same `ui.custom_css` preference and injects that stylesheet into its own document.
`migrationV2` is the preboot exception because it does not initialize preferences.

```css
:root {
  --color-primary: hotpink;
}

[data-ui~='scope:window:selection-toolbar'] {
  --color-primary: lime;
}
```

Electron renderer windows are separate documents, so a stylesheet injected into one cannot leak into another; uniform
theming comes from preference synchronization rather than a CSS `@scope` wrapper. Use `scope:window:*` only when a theme
intentionally needs a per-window override.

CSS cannot cross a Shadow DOM or iframe boundary. App-owned shadow roots remain intentionally isolated and need their own
adopted theme sheet if they are later made public. DOM created from third-party runtime HTML is not automatically part of
the source contract; its owning renderer must expose a stable boundary or explicit semantic nodes.

## Compatibility rules

- Semantic IDs are lowercase dot-separated roles, not descriptions of current copy or appearance.
- Explicitly declared semantic IDs are public API. Rename them only with a compatibility alias and a breaking-change
  entry.
- Inferred semantic IDs are best-effort: they stay sticky while a node's source anchor is unchanged but are re-derived
  when the node moves or is renamed. Themes that need a durable name must rely on an explicit semantic ID or a `part:`
  token.
- Exact `id:` tokens are immutable and never reused.
- Runtime state belongs in `state:`, `mode:`, or `variant:`; do not generate a new semantic ID for each state.
- Tests and automation must query semantic/exact tokens, then use accessible roles for the intended interaction. The
  contract identifies nodes; it does not grant arbitrary script execution or bypass application permissions.
