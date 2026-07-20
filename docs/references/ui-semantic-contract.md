# UI Semantic Contract

Cherry Studio exposes app-owned HTML elements and public SVG boundaries through one machine-readable `data-ui`
attribute. It is the maintained selector interface for user themes, end-to-end tests, inspectors, and controlled AI
automation. Internal classes, DOM ancestry, and unmarked SVG drawing primitives are not part of this contract.

The primary consumer is advanced Custom CSS. Users need a supported way to restyle or restructure arbitrary app-owned
nodes without coupling persistent themes to implementation classes. Structured theme variables remain the preferred
surface for common theming; `data-ui` is the node-level escape hatch for rules that variables cannot express. Tests and
automation can reuse the same coordinates instead of introducing a second selector protocol.

## Token protocol

`data-ui` is an unordered set of whitespace-separated tokens. The compiler writes tokens in this canonical order:

```html
<article
  data-ui="chat.message part:message-content id:ui-3976699e5846d12a scope:message:m_817 scope:topic:t_42"
></article>
```

| Token | Meaning | Stability |
| --- | --- | --- |
| `chat.message` | Human-readable semantic role | Stable public grouping selector |
| `part:message-content` | Reusable component structure role | Stable public part selector |
| `id:ui-3976699e5846d12a` | Registered exact source node | Stable across builds and unambiguous DOM-preserving moves |
| `scope:message:m_817` | Runtime instance identity | Stable for that business entity |
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
[data-ui~='id:ui-7b21d4a8062c6f81'] {
  display: none;
}
```

## Build-time contract

The pre-transform Vite plugin parses TSX/JSX with SWC and annotates every intrinsic HTML element plus each `svg` root
before the React compiler runs. Reusable component structure, including Cherry Studio's Radix/Shadcn primitives, is
represented by `part:*` tokens in the same attribute. Window HTML is annotated by the same plugin. Exact `id:*` tokens
belong only to intrinsic DOM source nodes. A semantic `data-ui` value passed through a component is merged with the
intrinsic node's part and exact ID, including across JSX prop spreads and Radix `asChild` slots.

`packages/ui` keeps Shadcn-compatible, static `data-slot` markers as private component-library structure. When Cherry
Studio consumes that source, the plugin mirrors each marker into the public contract (`data-slot="dialog-content"` →
`part:dialog-content`) while leaving the library marker intact for its own styles and standalone build. Renderer source
and window HTML must author `part:*` directly; `data-slot` outside `packages/ui/src` is rejected. Application code,
themes, and tests must depend only on `data-ui`, never on the library-private marker.

SVG drawing internals such as `path`, `g`, `defs`, gradients, masks, filters, and shapes are implementation details by
default. They enter the public contract only when they carry `data-ui`, `data-testid`, `role`, an event handler, or a
static `packages/ui` `data-slot`. HTML descendants of `foreignObject` are annotated normally. This keeps icons themeable
through their stable `svg` boundary while avoiding thousands of fragile IDs for generated vector paths; a drawing part
that genuinely needs independent styling or testing can opt in explicitly.

Semantic inference uses, in order:

1. an explicit semantic ID passed to `uiTokens` or a static `data-ui` value;
2. `part:*`, `data-testid`, stable `id`/`name`/`type`, and event-handler names;
3. source domain, component name, and element role.

Visible text is never an identity input, so localization, copy changes, and formatting do not change a node's exact ID.
Line numbers, timestamps, random values, class names, and build traversal order are also excluded.

New exact IDs start as `ui-` followed by the first 16 hexadecimal characters of the node's SHA-256 source-anchor hash.
The anchor includes normalized source path, component, semantic role, element, stable attributes/parts, parent semantic
role, and same-shape occurrence. The committed `ui-contract.registry.json` then preserves that ID while reconciling the
current source.

The registry intentionally stores only the state required for identity reconciliation:

```json
{
  "version": 1,
  "nodes": [["anchorHash", "fingerprintHash", "ui-0123456789abcdef"]]
}
```

`semanticId` remains source-derived and is not duplicated in the registry. Deleted IDs are not retained as tombstones
because the contract does not promise permanent non-reuse. Reconciliation first honors Git-confirmed file moves, then
reuses direct anchors only when the full same-shape occurrence cohort is unchanged, and finally matches exactly one
departed and one arrived node with the same structural fingerprint. Adding or removing indistinguishable siblings
rotates that cohort's IDs instead of guessing which source node retained an occurrence anchor. This preserves identity
for recognizable DOM nodes without silently retargeting selectors or turning the registry into a cross-version
compatibility ledger.

After changing renderer markup, update and commit the registry:

```bash
pnpm ui:contract:sync
```

When a merge or rebase conflicts on `ui-contract.registry.json`, accept either side and rerun the sync command on the
merged source; never hand-edit the generated tuples.

Production builds and CI reject registry drift through `pnpm ui:contract:check`. Builds also validate that assigned IDs
are unique, then emit a deterministic, dictionary-packed `ui-contract.json` asset. Its `columns` field describes each
node tuple; the `sources`, `semantics`, `elements`, and `components` dictionaries map tuple indexes back to readable
metadata. Theme inspectors and AI tools should discover the contract from this manifest instead of scraping
implementation classes.

During source work, an agent or developer can resolve a semantic prefix without building the app:

```bash
pnpm ui:contract:query chat.message
```

The command scans the current source and returns registered exact IDs, element/component names, and relative source
locations as JSON. It rejects a stale registry and applies the same collision check as the build.

## Runtime API

Use the curated runtime helpers for entity scopes. Do not concatenate free-form strings:

```tsx
import { uiTokens } from '@renderer/utils/uiContract'

<div
  data-ui={uiTokens('chat.message', {
    scopes: [`message:${message.id}`, `topic:${message.topicId}`]
  })}
/>
```

`uiTokens` writes only the explicit semantic ID and runtime `scope:*` tokens. Exact `id:*` tokens are compiler-owned;
application code must not author them. Reusable `part:*` tokens describe static component structure and must be declared
in the owning component's markup rather than selected dynamically at runtime. `uiTokens` validates the token grammar,
removes duplicates, and serializes deterministically. `parseUiTokens` supports inspectors. `uiSelector` creates exact
CSS selectors across semantic, part, exact-ID, and scope tokens. Playwright code can use
`uiLocator(page, 'chat.message', options)` from `tests/e2e/utils`.

Runtime scopes may contain durable business IDs already present in the renderer. Do not place secrets, prompt content,
credentials, or user-visible text in a token.

## Custom CSS across windows

Each window body exposes its window identity:

```html
<body data-ui="app.window id:ui-3976699e5846d12a scope:window:main">
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
- Inferred semantic IDs are deterministic but best-effort and are re-derived from the current source. Themes that need a
  durable name must rely on an explicit semantic ID or a `part:` token.
- Exact `id:` tokens identify a registered source node. They remain stable across formatting, copy changes, unchanged
  occurrence cohorts, and unambiguous DOM-preserving moves. Ambiguous structural refactors may receive new IDs, and
  deleted IDs do not carry a permanent no-reuse guarantee.
- Tests and automation must query semantic/exact tokens, then use accessible roles for the intended interaction. The
  contract identifies nodes; it does not grant arbitrary script execution or bypass application permissions.
