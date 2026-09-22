Design first, then main-process plumbing, then UI. i18n keys land WITH their components or CI fails.

## 1. Design

- [x] 1.1 Produce the section's information architecture with the `impeccable`, `ui-ux-pro-max`, `anth-frontend-design` and `frontend-ui-engineering` skills, working WITHIN `DESIGN.md`'s stated direction (neutral-first, semantic colour, content-first) and `@cherrystudio/ui`. Introducing a second component vocabulary would be a defect, not better design — the skills govern hierarchy, state design and copy.
- [x] 1.2 Design the states explicitly, since they are what this page is for: every service down; Docker absent; push in progress; full pack detected (push disabled, with reason); doctor running; a check failed with a repair; a check failed with no repair.
- [x] 1.3 Write the copy for all of the above, then derive the i18n keys from it.

## 2. Doctor check source

- [x] 2.1 Test first: JSON-line parsing, the `refused` → `failed` mapping, a crashed process still publishing a terminal state, and partial results publishing before completion.
- [x] 2.2 Implement the source. Spawn via the app-data copy; resolve paths through `application.getPath(...)`; log through `loggerService.withContext(...)`.
- [x] 2.3 Wire repair to `--fix copy-skills`; assert the refusal path surfaces rather than being swallowed.

## 3. Startup push

- [x] 3.1 Test first: copies when absent; copies when differing; **writes nothing when the full pack is detected**; never creates a symlink; the notice appears and clears.
- [x] 3.2 Implement as a BaseService with `@Injectable`/`@ServicePhase`/`@DependsOn`, registered in `serviceRegistry.ts`, reached via `application.get(...)`. Chain after `reconcileSkills()`. Never touch `main.ts`.

## 4. Preferences and i18n

- [x] 4.1 Add keys to `classification.json`; run `pnpm data:generate`. Confirm `preferenceSchemas.ts` regenerates with them and that no migration was created.
- [x] 4.2 Add every i18n key to `en-us`, then `pnpm i18n:sync`; confirm `pnpm i18n:check` passes across all 13.

## 5. UI

- [x] 5.1 Build the page from `SettingsPrimitives` + `@cherrystudio/ui`, per the §1 design.
- [x] 5.2 Register in all three places: route file, `settingsMenu.ts`, `prometheus.search.ts`.

## 6. Verify

- [x] 6.1 Targeted tests, then `pnpm lint`.
- [ ] 6.2 Exercise each §1.2 state in the running app; screenshot each.
- [x] 6.3 **On a full-pack machine:** confirm the push is skipped and the notice explains why. This development machine is such a case — 42 mini skill copies already sit beside a full-pack install.
- [ ] 6.4 **Windows:** repeat 6.2. Unverified until run.
