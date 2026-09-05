# Diagnostics Pre-Push Remediation Design

## Goal

Make the pending diagnostics changes safe to push by preserving keyboard access when the sidebar is hidden,
showing complete expanded check descriptions, and correcting the affected tests and locale expectation.

## Scope

- Add a System diagnostics action to the hidden-sidebar shell actions. The action uses the existing localized
  diagnostics label and opens `DoctorPopup` directly on the checks panel.
- Keep the normal-sidebar Help menu as the primary diagnostics entry. Do not restore the removed About Settings
  entry or add a new navigation surface.
- Remove visual truncation from expanded Doctor check descriptions so the localized detail remains readable.
- Make the AI persistence-failure test control the diagnosis status and assert that the completed diagnosis remains
  visible after persistence rejects.
- Remove the error-detail icon DOM-shape test because accessible labels, tooltip behavior, and user interactions are
  the supported contract.
- Align the English lazy-i18n test with the current source-of-truth copy, `Full check`.

No backend, IPC, persistence, shared Doctor types, or new locale keys are required.

## Interaction and accessibility contract

When `sidebarWidth < 20`, `ShellTabBarActions` exposes a focusable button named with
`settings.doctor.entry.title`. Activating it by keyboard or pointer calls
`DoctorPopup.show({ initialPanel: 'checks' })`. The existing Settings action remains unchanged.

The action is limited to the hidden-sidebar branch because the visible sidebar already exposes Help and avoids two
adjacent diagnostics entries. Expanded Doctor rows wrap their detail text instead of ellipsizing it; collapsed row
titles may continue to truncate because their disclosure content provides the complete detail.

## Verification

1. A renderer component test sets the sidebar width to the hidden state, reaches the diagnostics action with Tab,
   activates it from the keyboard, and observes the popup command with the checks panel selected.
2. The AI persistence test drives a completed diagnosis through a controlled wrapper, rejects persistence, and
   confirms the diagnosis text remains visible.
3. Existing error-detail and Doctor interaction tests continue to cover accessible names, disclosure behavior,
   evidence, and actions without asserting SVG or CSS implementation details.
4. Targeted renderer tests, `pnpm lint`, `pnpm test:lint`, and the repository gate required for the final combined
   change pass before commit and push.
