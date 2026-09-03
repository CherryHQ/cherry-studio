# Stage 5 / Track D — Cross-Platform UI Primitives (Narrowed Dual-Implementation Strategy)

## Objective

Establish a single UI package exposing one component API with platform-forked implementations
(web: Radix/Base UI; native: rn-primitives), seeded from the measured component intersection,
under an explicit dual-birth discipline for new design-system primitives. Existing single-platform
components are not migrated.

## Preconditions

Stage 2a (design-tokens promoted — the shared token source both implementations consume).
Fully independent of Tracks A–C.

## Measured Constraints (design rationale)

- **Component vocabulary overlap: 6 of 91.** Desktop `packages/ui`: 76 components
  (pointer-idiom vocabulary — `dialog`, `context-menu`, `hover-card`, `combobox`, `data-table`,
  `resizable`, …). Mobile `ui-native`: 21 components (touch-idiom vocabulary — `bottom-sheet`,
  `composer`, `scroll-shadow`, `shimmer-text`, …). Intersection: `alert`, `button`, `input`,
  `slider`, `switch`, `tabs`. Merging the two existing packages wholesale would therefore unify
  nothing for 85 components while coupling two design systems.
- **`ui-native` is not a pure-JS package.** It vendors native build artifacts:
  `CherryStudioUI.podspec`, `ios/HybridCherryMenuView.swift`, `android/.../cpp-adapter.cpp` +
  Kotlin sources, `nitrogen/generated/` (Nitro codegen). These require pod/gradle toolchains and
  Expo autolinking.
- **Resolution isolation is sound** (validated): Metro honors the `"react-native"` export
  condition and `.native.tsx` platform extensions; Vite resolves `default`/`import`; under a
  single lockfile the install surface is workspace-wide regardless of package layout;
  electron-builder packages the Vite bundle output and never touches podspecs. Cross-bundler
  leakage is not a blocker.
- **Radix/Base UI are DOM libraries.** Their "mobile support" means mobile *browsers* (touch
  events, responsive layout over `document`/`HTMLElement`), not React Native. The mobile app
  renders natively (Fabric/Nitro, Skia, Reanimated worklets) with no DOM. API-shape parity on RN
  is obtained through the `rn-primitives` ecosystem, which mirrors Radix component APIs over RN
  primitives — one contract, two implementations remains the irreducible cost.

## Package Topology

```
packages/ui-primitives/                   # new dual-implementation package
  src/button/
    button.tsx                            # web implementation (Radix / Base UI)
    button.native.tsx                     # RN implementation (rn-primitives)
    button.shared.ts                      # platform-free: props contract, variants (cva), token mapping
    __tests__/                            # contract tests, executed per platform
  src/index.ts / src/index.native.ts
  package.json:
    exports: { ".": { "types": …, "react-native": "./src/index.native.ts", "default": "./src/index.ts" } }

apps/mobile/packages/ui-nitro/            # native-module stratum extracted from ui-native
  CherryStudioUI.podspec, ios/, android/, nitrogen/, TS bindings
  (hybrid native views have no web counterpart; excluded from the universal package by construction)
```

- `apps/mobile/tsconfig.json`: set `"customConditions": ["react-native"]` so the mobile type
  graph resolves RN typings instead of DOM typings.
- Lint (extends Stage 0d): within `ui-primitives`, `.tsx` files may not import RN modules;
  `.native.tsx` files may not import DOM/Radix modules; `.shared.ts` may import neither.

## Procedure

1. **Extract `ui-nitro`.** Move `apps/mobile/packages/ui/{ios,android,nitrogen,CherryStudioUI.podspec}`
   plus their TS bindings into `apps/mobile/packages/ui-nitro/`; `ui-native` depends on it.
   Verify Expo autolinking discovers the relocated module (pod install + android build).
2. **Seed migration — 6 components, one PR each:**
   `alert` → `button` → `input` → `switch` → `tabs` → `slider`.
   - Web implementation lifted from `packages/ui/src/components/primitives/<name>.tsx`,
     preserving the desktop-facing props contract.
   - Native implementation lifted from `apps/mobile/packages/ui/src/components/<name>/`, API
     aligned to the shared contract (web contract is the baseline; touch-specific divergence is
     encapsulated inside `.native.tsx`).
   - Original locations re-export from `ui-primitives` (both `packages/ui` and `ui-native`) —
     **zero import churn for either application's consumers** (Invariant I2 applied to UI).
3. **Dual-birth discipline (effective at first seed merge):** every new **design-system-level
   primitive** ships `.tsx` + `.native.tsx` + `.shared.ts` in the same PR. Page-level composites
   are exempt. The 85 existing single-platform components are not migrated.
4. **Quarterly review:** after one quarter, evaluate the sustained cost of the dual-birth
   discipline (velocity coupling to the slower platform is its real price — an organizational
   commitment, not a build-system property). Decide expansion, steady-state, or rollback of scope.

## Verification (per-component PR)

```
pnpm test:pkg:ui                                  # desktop ui project (green through re-exports)
pnpm --filter cherry-studio-app test              # mobile (Jest, RN rendering)
```
Storybook on both sides (desktop `packages/ui` Storybook; mobile `.rnstorybook`) renders the
component; visual token parity verified against the shared `design-tokens` source.
