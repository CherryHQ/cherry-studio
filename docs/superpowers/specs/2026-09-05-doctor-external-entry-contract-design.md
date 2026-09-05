# Doctor External Entry Contract

## Goal

Complete the existing cross-process Doctor entry contract so native Help and generic protocol navigation open the requested Doctor panel instead of stopping on About settings.

## Scope

- Reuse the shared `DoctorPanel` type in the renderer rather than maintaining a duplicate union.
- Validate the optional `doctor` search parameter on `/settings/about` against the shared panel values.
- Treat the About route as a bridge: when a valid panel is present, remove the one-shot query parameter with a replace navigation and open `DoctorPopup` on that panel.
- Keep the current visible Doctor entries in Help and the hidden-sidebar shell actions unchanged.
- Do not restore a visible Doctor action row in About settings.
- Do not add a Doctor-specific protocol handler; the existing generic navigate protocol already preserves the query string.
- Do not add the deferred Settings-to-Doctor return hint.

## Behavior

`doctorSettingsPath(panel)` produces `/settings/about?doctor=<panel>`. Native Help and a URL such as `cherrystudio://navigate/settings/about?doctor=checks` deliver that route to the renderer. The About route accepts only `checks`, `export`, or `report`; unsupported values degrade to no Doctor request.

When About receives a valid request, it removes only `doctor` while preserving unrelated search parameters, using replace navigation so the command is consumed once. It then opens the existing renderer-owned popup with the requested initial panel. Clearing the parameter allows the same external command to be delivered again after the popup closes and avoids reopening it on refresh or tab restoration.

## Testing

The regression worth protecting is that a valid external Doctor route currently renders About without opening Doctor. A focused About component test will provide a valid route search value, observe the popup command, and verify that the consumed parameter is removed while unrelated parameters are preserved. A route validation test will verify that unsupported panel values are discarded.

No protocol-specific renderer test is needed because the existing protocol handler already tests query preservation, and no test is needed for the type-only replacement of the duplicate `DoctorPanel` declaration.

## Verification

Run the focused About and settings-route renderer tests, followed by the repository-required lint gate. The change is renderer-only and does not alter IPC, persistence, or backend Doctor behavior.
