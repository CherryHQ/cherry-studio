# UI Semantic Contract

Cherry Studio exposes meaningful app-owned DOM boundaries through one machine-readable `data-ui` attribute. It is the
maintained selector interface for user themes, end-to-end tests, inspectors, and controlled AI automation. Internal
classes, incidental DOM ancestry, and unmarked implementation wrappers are not part of this contract.

The primary consumer is advanced Custom CSS. Structured theme variables remain the preferred surface for common
theming; `data-ui` is the semantic escape hatch for rules that variables cannot express. Tests and automation can reuse
the same coordinates instead of introducing another selector protocol.

## Token protocol

`data-ui` is an unordered set of whitespace-separated static semantic tokens:

| Tokens | Use | Stability |
| --- | --- | --- |
| `chat.message` | Business or component role | Explicit roles are stable; inferred roles are best-effort |
| `part:message-content` | Reusable component structure | Maintained public API |

```html
<article data-ui="chat.message part:message-content"></article>
```

Use token matching (`~=`), never substring matching:

```css
/* Every chat message */
[data-ui~='chat.message'] {
  display: grid;
}

/* One reusable component part */
[data-ui~='part:dialog-content'] {
  border-radius: 8px;
}
```

Ordinary implementation children do not need their own token. Custom CSS can traverse from the nearest semantic
boundary; those descendant selectors intentionally follow internal DOM and may need updates after a refactor:

```css
[data-ui~='chat.message'] > div:nth-child(2) {
  max-width: none;
}
```

If a child becomes a commonly used or compatibility-sensitive target, promote it to the maintained contract with an
explicit semantic role or `data-slot`.

## Build-time generation

The pre-transform Vite plugin parses TSX/JSX with SWC before the React compiler. It annotates:

- intrinsic roots rendered by a component or fragment branch;
- semantic HTML elements such as buttons, inputs, links, regions, lists, and media;
- nodes with an explicit `data-ui`, `data-slot`, `data-testid`, stable `id`/`name`/`role`/`type`, or event handler;
- each window body and public `svg` root.

Nested `div` and `span` wrappers without any semantic signal remain unmarked. This avoids turning layout-only DOM into
a public API.

Reusable component structure is represented by `part:*` tokens in the same attribute. Existing static `data-slot`
markers remain unchanged throughout the project. The generator treats their values as authored structural semantics:

```html
<div data-slot="dialog-content" data-ui="part:dialog-content"></div>
```

Explicit `data-ui` parts and `data-slot` values enter the same normalization rule. The original `data-slot` attribute
remains intact, so existing component styles, tests, and custom CSS continue to work.

Semantic inference uses, in order:

1. an explicit semantic role written as a static `data-ui` value;
2. `part:*`, `data-testid`, stable `id`/`name`/`role`/`type`, and event-handler names;
3. source domain, component name, and HTML element role.

For example, a `MessageGroup` component under the chat source domain can produce `chat.message-group`; a copy action
inside it can produce `chat.message-group.action.copy`. Visible text is never an input, so localization and copy changes
do not rename selectors. Line numbers, timestamps, random values, and class names are also excluded.

File and component names make inferred semantics readable but are not a permanent identity system. Moving or renaming a
component can change its inferred role. Long-lived themes should use explicit semantic roles or maintained `part:*`
tokens for selectors that must survive such refactors.

SVG drawing internals such as `path`, `g`, `defs`, gradients, masks, filters, and shapes are implementation details by
default. They enter the public contract only when they carry `data-ui`, `data-slot`, `data-testid`, `role`, or an event
handler. HTML descendants of `foreignObject` are processed as a new semantic boundary.

During source work, resolve a semantic prefix without building the app:

```bash
pnpm ui:contract:query chat.message
```

The command scans current source and returns matching semantic roles, element/component names, and source locations.
There is no persistent node registry or generated exact-node ID.

## Selector helpers

Declare compatibility-sensitive business semantics directly in the owning component's markup:

```tsx
<div data-ui="chat.message" />
```

Reusable `part:*` tokens are also declared in the owning component's markup, either explicitly or through a static
`data-slot`. `parseUiTokens` supports inspectors, while `uiSelector` and `uiLocator` compose semantic and structural
selectors without duplicating the token grammar.

## Custom CSS across windows

Each window body exposes the same semantic root:

```html
<body data-ui="app.window">
```

Custom CSS is inserted verbatim and unlayered after application styles, so it can use the full CSS surface—including
`:root`, `body`, top-level at-rules, and semantic `data-ui` selectors—without blanket `!important`. Every regular
renderer window subscribes to the same `ui.custom_css` preference and injects that stylesheet into its own document.
`migrationV2` is the preboot exception because it does not initialize preferences.

```css
:root {
  --color-primary: hotpink;
}
```

Electron renderer windows are separate documents, so a stylesheet injected into one cannot leak into another. CSS
cannot cross a Shadow DOM or iframe boundary; an app-owned isolated root must expose its own semantic boundary if it is
made public.

## Compatibility rules

- Semantic roles are lowercase dot-separated identifiers, not descriptions of current copy or appearance.
- Explicit semantic roles and `part:*` tokens are maintained public API. Rename them only with a compatibility alias and
  a breaking-change entry.
- Inferred roles are deterministic but best-effort and may change when files, components, or DOM responsibilities move.
- Internal descendant selectors are supported CSS but are not promised to survive structural refactors.
- Tests and automation should start from semantic or `part:*` tokens, then use accessible roles for the intended
  interaction.
