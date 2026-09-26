# Prometheus UI/UX protocol
Version 1. Project copies at `.agents/UI_UX_PROTOCOL.md` override the bundled default. Load only for tasks changing rendered UI, interaction, tokens, motion or on-screen copy. Backend-only code still uses its selected project team without loading UI guidance.

## Authority and context
User instructions and project rules govern scope. Read PRODUCT.md, DESIGN.md, .impeccable.md, the nearest application's surface brief, existing components and token sources before proposing direction. Preserve existing design authority. Impeccable supplies workflow context; mini uses the explicitly bounded `prometheus-impeccable-core` adaptation. Recommendations do not overwrite DESIGN.md. Pro Max design output stays in its design-system directory; Stitch output uses DESIGN.stitch.md.

## Selective routing
1. Resolve the affected application, including nested manifests, and classify new surface, explicit redesign, refinement or review. Default uncertain existing work to refinement; ask when ambiguity blocks correctness.
2. Load `prometheus-impeccable-core` for portable context, or configured full Impeccable when available. Do not invoke a missing native engine or download one.
3. Consult `ui-ux-pro-max` with a focused domain/stack query. A complete design system is appropriate only when establishing visual direction, never for ordinary refinement or review.
4. For new work choose `gpt-taste` only when the actual model family is GPT; otherwise use `design-taste-frontend`. Explicit redesign uses `redesign-existing-projects`. Refinement/review load no taste. At most one implementation plus one overlay explicitly chosen by the user or design authority. Preserve experimental/v1 identities. Never select a model from the harness name.
5. Select one craft skill: layout → better-layout; typeset → better-typography; colorize → better-colors; clarify/copy → better-writing; audit/harden → better-accessibility; animate/delight → better-ui; broad work → better-interface.
6. Add relevant platform guidance from the nearest application manifests. React/Vercel guidance applies only to relevant components; Expo guidance must match its declared SDK. Flutter, SwiftUI and Android preserve framework prerequisites and project versions. Tauri reuses the project's Tauri skills; Electron uses the project's Electron workflow. Other stacks use matching Pro Max data and current official documentation, without invented specialist endorsements.
7. Designers/directors route context and direction; implementers route context, craft and platform; reviewers use prometheus-ui-review without taste. Existing team IDs, ownership and native permissions remain authoritative.

## Surface modes
Marketing/landing/pricing → Persuade (variance 7–8, motion 5–7, density 3–4).
Operational apps/admin/tools → Operate (3–4, 2–3, 6–8).
Docs/articles/changelogs → Read (2–3, 1–2, 4–5).
Portfolio/showcase → Experience (8–9, 7–8, 2–3).
Record chosen values in the surface brief when direction is established. Incumbent tokens, product identity and explicit user choices override defaults. Honor reduced motion.

## Craft and accessibility
Preserve semantic structure, visible keyboard focus, contrast, reading order and relevant loading/empty/error/disabled/overflow states. WCAG 2.2 AA target size is 24 by 24 CSS pixels **or the criterion's spacing/other exceptions**; equivalent controls, inline text, user-agent control and essential presentation have defined exceptions. A 44-pixel touch target is a project usability preference, not a universal AA requirement. Native targets use platform units and guidelines (points/dp), not CSS units. Text contrast is generally 4.5:1, large text 3:1; apply actual WCAG exceptions. Do not impose a third-party visual ban list over project design authority.

## Completed-phase review
Finish the full authorized production phase before verification. Then capture applicable device widths and theme states, real content, keyboard focus and reduced motion through available platform tools. Use one batched correction and confirmation cycle. Request an independent read-only reviewer in a separate context; PASS/BLOCK requires evidence. Unresolved blocking findings stay blocking. If independent delegation or device tooling is unavailable, report it as unverified; builder self-review is not independent review.
Automatic review uses prometheus-ui-review and auto-invocable better-* guidance. Upstream interface-review, break, variant and explain-interface remain user-only: never bypass disable-model-invocation by reading their files. Explicit user invocation may use their documented workflow.
No per-edit hooks, native detector or live-browser engine are implied by the mini adaptation.

## Team and harness behavior
Read .agent-team/project-routing.json and its real team manifest. For all code tasks select the relevant existing roles, preserve ownership, model policy, permissions and concurrency. Use native delegation only where actually available. Otherwise use role instructions sequentially and disclose the limitation. Zed's parallel-thread UI is not a delegation API; external ACP agents retain native configuration.

## Handoff evidence
Record operation, surface mode, loaded skills, affected application, context authority, changed files, states/capture paths, reviewer identity and evidence, unresolved findings and platform gaps. No skill is certified universally best; catalog inclusion records provenance and suitability, not comparative proof.

