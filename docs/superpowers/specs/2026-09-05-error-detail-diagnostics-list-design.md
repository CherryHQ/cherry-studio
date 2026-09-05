# Error Detail Unified Diagnostics List Design

## Goal

Match the error-detail prototype by presenting AI diagnosis and real System Doctor results as one expandable list.
Every Doctor row has a right-side disclosure affordance, while the standalone System Doctor dialog keeps its
existing domain-grouped presentation.

## Interaction contract

- The error-detail diagnostics surface uses one single-selection, collapsible accordion.
- AI diagnosis is the first item whenever an error or cached diagnosis is available.
- The AI item is initially expanded so its action, error, or completed diagnosis remains discoverable.
- Opening a Doctor item closes the AI item or any previously opened Doctor item, matching the prototype.
- Every Doctor result row is an accordion trigger with its current status icon, title, status badge, and the shared
  right-side chevron supplied by `@cherrystudio/ui`.
- Expanding a Doctor row reveals its localized result description, available evidence, and existing actions.
- Only real `controller.viewModel.rows` are rendered; no fixed count or synthetic prototype checks are introduced.

The current Doctor contract exposes one localized detail string rather than separate summary, reason, and advice
fields. To avoid duplicating that string, the collapsed row shows identity and status, and the detail appears in the
expanded content. Adding separate diagnostic prose is outside this change.

## Component ownership

- `ErrorDiagnosticsPanel` owns the unified accordion because it is the only component that combines AI and Doctor
  results.
- `AiDiagnosisSection` renders one accordion item and continues to own diagnosis execution, retry, persistence, and
  result presentation.
- The error-detail Doctor list renders accordion items from `controller.viewModel.rows` and reuses the existing
  evidence and action behavior.
- `DoctorCheckResults` remains the grouped standalone-Doctor component; its expansion state and behavior do not
  change.

No backend, IPC, shared Doctor state, persistence, or i18n contract changes are required.

## Accessibility

`AccordionTrigger` owns keyboard activation, focus-visible state, `aria-expanded`, and the chevron. Interactive
diagnosis, retry, evidence, and remediation buttons stay inside accordion content so triggers never contain nested
interactive controls.

## Verification

Component tests will prove that:

1. The completed AI diagnosis is visible initially.
2. Every Doctor row is exposed as an accessible disclosure trigger.
3. Opening a Doctor row reveals its detail and collapses the AI content.
4. The standalone Doctor domain accordion still passes its existing interaction tests.

Tests will not assert CSS classes, a fixed result count, or synthetic prototype-only checks.
