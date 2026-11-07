# Agent Note: Unify selection references and webview annotations

Status: proposed

English | [中文](2026-09-20-unify-selection-reference-and-webview-annotation.zh.md)

## Problem

One user gesture — *pick a unit on a surface and hand it to the agent* — shipped twice, with no
shared code between the two implementations. Both toggles live in sibling capabilities of the same
agent right pane (`files` at `src/renderer/pages/agents/components/AgentRightPane/AgentRightPane.tsx:1536`,
`browser` at `:1520`), so a user meets both one tab apart.

| Seam | Selection reference (files) | Webview annotation (browser, #17842 / `128a3a19cb`) |
|---|---|---|
| Toggle | `SquareDashedMousePointer`, `ArtifactPane.tsx:467-487` | `MousePointer2`, `WebviewAnnotationControls.tsx:126-145` |
| Label | `agent.preview_pane.pick_selection` — "Select region" / "选区" (`en-us.json:150`, `zh-cn.json:150`) | `webview.annotation.enable_mode` — "Annotate page" / "标注页面" (`en-us.json:5699`, `zh-cn.json:5699`) |
| Highlight | renderer React + Tailwind | guest shadow-root CSS, accent hardcoded at `src/preload/WebviewAnnotationController.ts:635` (`#818cf8` / `#4f46e5`), consumed by `:52-87` |
| Event | `INSERT_COMPOSER_SELECTION_REFERENCE` (`AgentRightPane.tsx:921-930`) | `INSERT_AGENT_COMPOSER_TOKEN` (`:983-1001`) |
| Token kind | `reference` (`selectionReferenceToken.ts:36-43`) | `webviewAnnotation` (`AgentRightPane.tsx:995`) |
| Payload | structural anchor + `excerpt` + `fileStamp` (`src/renderer/types/selectionReference.ts:103-128`) | CSS selector + optional `region {rect, elements}` + **mandatory** `comment` (`src/shared/types/webviewAnnotation.ts:31-81`, `min(1)` at `:77`) |
| Prompt encoding | fenced `selection-ref` JSON, machine-parseable (`selectionReferenceToken.ts:42`) | Markdown prose, `## User annotation request` + `## Untrusted page reference data` (`src/shared/utils/webviewAnnotations.ts:77`) |
| Consumer | `resources/skills/office-transform/SKILL.md:30-36`, which feeds `anchor` straight to `--anchor` | the model only |
| Length guard | enforced before insert; refuses with `chat.input.reference_panel.no_room_selection` (`useComposerSelectionReferenceInsertion.ts:42-48`) | none — `AgentComposer.tsx:1111-1120` calls `insertToken` directly |

Three addressing vocabularies exist overall: document anchors (`selectionReference.ts:103-108`,
explicitly "never DOM or pixel coordinates", `:5-13`), CSS selectors (`webviewAnnotation.ts:31-41`),
and browser-use's ephemeral `eN` refs (`src/main/ai/mcp/browserToolDefinitions.ts:5`, "Refs expire
on navigation", `:68`) backed by `backendNodeId` (`src/main/features/browser/browserUse.ts:10-12`).
The design doc already names two of them as needing reconciliation
(`docs/references/ai/browser-use-design.md:191-199`).

## Proposal

Four layers, each independently shippable. Layers 1-3 change the hand-off only; the picker engines
stay separate.

### Layer 1 — visual parity (PR-A, already in flight)

One icon for both toggles; the guest overlay derives `--annotation-accent` from the app primary
instead of the hardcoded pair at `WebviewAnnotationController.ts:635`, at the same hover (40%) /
active (100%) weights the renderer picker uses. Labels unchanged at this layer.

### Layer 2 — one hand-off

Add a `web` variant to `DocumentAnchor` (`selectionReference.ts:103-108`):

```ts
{ format: 'web', url, selector, region?: { rect, elements } }
```

`excerpt` becomes the element's (or region's) text. Two adjacent fields are file-shaped and must
generalise with it: `path` is `AbsoluteFilePathSchema` (`:123`) and `fileStamp` is `{size, mtimeMs}`
(`:113-118`). Replace both with a discriminated `source`:
`{ kind: 'file', path, stamp } | { kind: 'page', url, title, capturedAt }`. The page stamp is what
the freshness check (`office-transform/SKILL.md:38-53`) has no analogue for on the web, and
recording it is cheaper than pretending a page is immutable.

Emit it as a `reference` token over `INSERT_COMPOSER_SELECTION_REFERENCE`, through the one length
guard at `useComposerSelectionReferenceInsertion.ts:42-48`, in the one prompt encoding — the fenced
`selection-ref` JSON, carrying the same untrusted-data notice the annotation prompt carries today
(`webviewAnnotations.ts:3-4`) as a sibling line outside the fence.

`webviewAnnotation` then stops being *produced* as a token kind, but **must stay readable**. The
kind sits in a persisted enum (`src/shared/data/types/uiParts.ts:261-271`) reached from a user
`TextUIPart`'s `providerMetadata.cherry.composer` (`:164`), and that meta is read with `safeParse`
returning `undefined` on failure (`:451-455`) — dropping the value would silently discard the
*entire* composer snapshot of every historic message containing an annotation chip, not just that
chip. **A read-compat shim, not a data migration**: keep `webviewAnnotation` in the enum marked
legacy-read-only, and remove it from the produced set in `composerTokenPolicy.ts:18-29`. No row
rewrite is needed because those tokens carry `messageText: true` (`:27`) — their prompt text is
already inlined in the persisted message text and does not depend on the chip.

### Layer 3 — one gesture

Make `comment` optional (`webviewAnnotation.ts:77`, and the Save button's empty-draft disable at
`WebviewAnnotationControls.tsx:228`). An empty save yields a plain reference (a citation); a filled
one yields today's annotation.

The note travels as an optional `note` field **on the reference payload**, inside the fenced JSON —
not as composer text. Composer text detaches intent from its anchor the moment a second reference is
inserted, and a skill parsing the fence would have to guess which prose belongs to which anchor;
`formatAgentWebviewAnnotationPrompt` already binds comment to element today. The cost is that a
`note` is no longer editable by retyping in the composer — mitigated by the chip's existing
reopenable editor.

Both toggles then share the label "Select region" / "选区", and "Annotate page" / "标注页面" becomes
the description of the optional comment step rather than the name of a mode.

### Layer 4 — deliberately unchanged

The picker engines stay separate: renderer React over a FilePreview plugin's view → structure
inverse mapping (`src/renderer/components/FilePreview/README.md:201-212`) versus the guest isolated
world's hover/marquee overlay. Browser-use's `eN` refs and the P3 `backendNodeId` mapping remain the
agent → page side and are untouched.

### Rollout

| PR | Content | Rough size |
|---|---|---|
| PR-A (in flight) | Layer 1 visual parity | small |
| PR-B | `source` + `web` anchor in the schema, page stamp, `web` case in `formatAnchorLabel` | medium |
| PR-C | Browser pane emits `reference` over `INSERT_COMPOSER_SELECTION_REFERENCE`; `webviewAnnotation` becomes legacy-read-only | medium |
| PR-D | Optional comment, `note` field, shared label | small |

Afterwards `docs/references/ai/browser-use-design.md` P3 (`:342-343`) should gain one paragraph —
added by that doc's owner, not by this note:

> The human → agent hand-off is a single `reference` token carrying a `web` `DocumentAnchor`
> (`url` + `selector` + optional `region`), so P3's locator work has one inbound shape to map. The
> annotation-target handoff contract is therefore the selector → `backendNodeId` resolution for that
> anchor plus its document identifier; the token schema itself needs no further additions.

## Why the comment is mandatory today

No written rationale exists — not in #17842, not in `browser-use-design.md:167-199`, not in a code
comment. The observable shape is that the feature is modelled as a **review comment pinned to an
element**: the placeholder reads "Describe what should change or what you noticed…"
(`WebviewAnnotationControls.tsx:190`), the prompt heading is `## User annotation request`
(`webviewAnnotations.ts:77`), and the clipboard export numbers them `### N. Annotation`
(`src/main/services/webview/annotationMarkdown.ts:92`, reached only from the copy path,
`useWebviewAnnotationSession.ts:574-581`). The element is the *where*; the comment is the *what*.

A selection reference is modelled as a **citation**: the *where* is the whole payload, and the
intent lives in the composer text the user types around the chip.

Recommendation: make the comment optional, empty = citation. Counter-argument this note does not
dismiss: an annotation with no intent is noise to the model, and keeping the two gestures distinct —
引用 versus 标注 — teaches users which one they are performing. The rebuttal is that the distinction
survives as the presence or absence of `note`, and the model receives the composer text either way.

## Alternatives considered

- **Keep them separate; align visuals only (Layer 1 alone).** Rejected as a stopping point, though
  it is a valid first PR: it removes the visible mismatch while leaving two token kinds, two events
  and two length-guard behaviours for every future consumer to learn.
- **Unify only the prompt encoding.** Rejected: rewriting the annotation prompt as `selection-ref`
  JSON without unifying the payload produces a fence whose `anchor` no consumer can use, and still
  leaves `webviewAnnotation` in the persisted enum with nothing to distinguish it.
- **Make annotation the superset and retire selection references.** Rejected: the annotation payload
  is DOM-addressed, which `selectionReference.ts:5-13` rules out on purpose because DOM coordinates
  drift with the rendering implementation; office-transform's anchor and freshness checks
  (`SKILL.md:38-64`) have no selector equivalent.
- **Unify the picker engines too.** Rejected: one runs in the renderer against a plugin's structural
  model, the other in the guest isolated world under a session-scoped bridge with a hard
  single-debugger-per-guest constraint (`browser-use-design.md:183-190`). They share a payload, not
  a runtime.

## Acceptance criteria

- `DocumentAnchor` accepts `format: 'web'`; `source` discriminates file from page; existing xlsx /
  docx / pdf / pptx references parse unchanged.
- The browser pane emits `reference` over `INSERT_COMPOSER_SELECTION_REFERENCE` and is subject to the
  same length guard; no call site emits `kind: 'webviewAnnotation'`.
- A persisted message carrying a `webviewAnnotation` token still renders its full composer snapshot
  after the change (regression test against `uiParts.ts:451-455`).
- Saving with an empty comment produces a reference chip; saving with text produces the same chip
  plus `note`.
- `office-transform` refuses `web` anchors with a stated reason instead of passing them to
  `--anchor`.

## Risks

- **Persisted-token compatibility.** The `safeParse`-returns-`undefined` failure mode is silent, so
  the shim must ship in the same PR that stops producing the kind, with a test, or history loses
  chips with no error.
- **Skill breakage.** `office-transform/SKILL.md:36` hands `anchor` directly to `--anchor`. A `web`
  anchor reaching a script that knows only four formats must be refused explicitly, or a browser
  skill must claim it.
- **The untrusted-data notice must survive the move.** It lives in the Markdown prose today
  (`webviewAnnotations.ts:3-4`); inside a JSON fence it has to sit outside the fence to stay readable
  as an instruction to the model rather than as data.
- **Regions have no document-anchor analogue.** `region {rect, elements}` is page-pixel geometry,
  exactly the kind of coordinate `selectionReference.ts:5-13` excludes for documents. It is admitted
  only under `format: 'web'`, where pixels are the page's own vocabulary — the exclusion still binds
  every other format.
- **Excerpt budget.** `SELECTION_EXCERPT_MAX_LENGTH` is 2000 (`selectionReference.ts:120`); a region
  of up to 12 elements (`webviewAnnotation.ts:12`) can exceed it and must truncate rather than
  refuse.
