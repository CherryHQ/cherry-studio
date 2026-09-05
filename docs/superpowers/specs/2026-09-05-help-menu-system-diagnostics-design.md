# Help Menu System Diagnostics Entry

## Goal

Move the system diagnostics entry from Settings > About to the sidebar Help menu, replacing the GitHub Star action. The relocated entry opens the existing diagnostics checks panel.

## Scope

- Remove the system diagnostics action row from About settings.
- Remove the About settings search entry for system diagnostics so search cannot target a missing row.
- Replace the Help menu's GitHub Star action in place with a System Diagnostics action.
- Reuse `DoctorPopup.show({ initialPanel: 'checks' })` after the Help popover closes.
- Reuse the existing `settings.doctor.entry.title` translation and stethoscope icon.
- Remove the Help menu's repository-opening constant, IPC action, GitHub icon, and unused `help.star` locale entries.
- Keep the repository controls in About settings unchanged; they are separate from the Help menu's GitHub Star action.

## Interaction

The Help menu continues to contain four compact actions in the same order. System Diagnostics occupies the former GitHub Star position. Selecting it first closes the popover through the existing `runAfterClose` flow, then opens the diagnostics popup on its checks panel.

## Testing

Use focused renderer component tests to protect these regressions:

- The Help menu exposes System Diagnostics instead of GitHub Star and opens the diagnostics checks panel.
- About settings no longer exposes the system diagnostics action.
- About settings search no longer indexes a diagnostics row that is absent from the page.

The popup command is the external observable boundary. No new test is needed for popup internals, visual styling, or the unchanged About repository controls.

## Verification

Run the focused Help menu and About settings renderer tests, plus the locale consistency check if locale resources change. Do not run the full test suite, per user request.
