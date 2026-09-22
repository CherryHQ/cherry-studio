Blocked on the mini's `docker-services`. Build the rendering, not the detection.

## 1. Gate

- [ ] 1.1 Confirm the mini's `lib/platform/docker.mjs` and `scripts/services.mjs` exist in the app-data copy. Until then implement only the "detection unavailable" path and stop.

## 2. Read state

- [ ] 2.1 Test first: each of `absent` / `daemon-down` / `ready` renders its own next step; a missing `services.mjs` reports unavailable rather than guessing; a spawn that fails does not raise a dialog.
- [ ] 2.2 Spawn `services.mjs status` through the same path `prometheus-003` uses for `doctor.mjs`.

## 3. Consent and actions

- [ ] 3.1 Add the consent preference to `classification.json`; regenerate.
- [ ] 3.2 Test first: `up` is unreachable without consent. Then wire `up`/`down` to explicit controls.

## 4. Verify

- [ ] 4.1 Targeted tests, then `pnpm lint`.
- [ ] 4.2 Exercise all three states on a machine with Docker, and confirm the app starts cleanly with Docker stopped.
- [ ] 4.3 **Windows:** confirm no `wsl.exe` is ever invoked and the loopback endpoints are reachable once up. Unverified until run.
