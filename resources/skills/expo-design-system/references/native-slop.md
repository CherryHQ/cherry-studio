# Native Slop: Named Anti-Pattern Tells

Recurring mistakes in generated React Native apps, with names, observable tells, and preferred replacements. Use these as review prompts: explain what harms the task, readability, or platform behavior. A card, font, gradient, or onboarding flow is not a defect by itself; respect the user's brief and existing design system. Interaction failures such as obscured inputs or false-empty states still need fixing.

## The 20 tells

| # | Name | The tell (observable) | Native instead |
|---|---|---|---|
| 1 | **The Web Modal** | A custom centered dialog for picking or composing that ignores keyboard space and platform dismissal | Native sheet (`presentation: 'formSheet'`, `@expo/ui` BottomSheet) or anchored menu; use native alerts for consequential confirmations |
| 2 | **The X-Button Sheet** | A sheet closed only by an "X" in the top corner - no grab handle, no swipe-to-dismiss | Native sheet with detents; drag down to dismiss; Cancel/Done in the header where the platform puts them |
| 3 | **Emoji Iconography** | 🔥 ⚙️ ✨ ❤️ as tab icons, buttons, or empty-state art | SF Symbols on iOS, Material icons on Android - one icon family per platform (see `expo-native-ui`) |
| 4 | **The Purple-Gradient Hero** | A decorative gradient intro pushes useful content and the primary task below the fold | Lead task screens with useful content under a navigation title; keep a hero when it serves the requested experience |
| 5 | **The Floating Pill Tab Bar** | A custom rounded, inset, drop-shadowed tab bar hovering above the home indicator | The platform tab bar (`NativeTabs`) with system-managed placement, materials, and behaviors |
| 6 | **Inter Everywhere** | An arbitrary downloaded font replaces the app's typography, with missing weights or poor readability | System type (SF / Roboto) by default; preserve brand typography when requested and verify weights, readability, and scaling |
| 7 | **Everything's a Card** | Every list row and section wrapped in its own white rounded shadowed card; cards nested inside cards | Grouped lists (`@expo/ui` List, iOS inset-grouped, Material sections); grouping via background + hairlines, not boxes |
| 8 | **Shadowboxing** | Heavy drop shadows (opacity ≥ 0.15, radius ≥ 10) doing hierarchy's job on white-on-white surfaces | 2-3 tokened elevation levels; hierarchy from the type ramp and grouping. iOS is a low-shadow platform |
| 9 | **Wireframe Borders** | A 1px gray `borderWidth` outlining every container - usually Tailwind's `#E5E7EB` from web muscle memory | Spacing and surface contrast; hairlines only as list separators (`StyleSheet.hairlineWidth`, semantic separator color) |
| 10 | **alert() Confirmation** | Alerts interrupt routine undoable actions, report success, or replace field validation | Native confirmation alert for uncommon irreversible actions; undo for routine reversible ones. Field errors stay inline; success updates the UI |
| 11 | **The Hand-Rolled Header** | `headerShown: false` plus a `<Text>` title and custom back button - losing large-title collapse, back-swipe, and scroll-to-top | Stack header options. The navigation bar is configured, never rebuilt |
| 12 | **16-Everything** | The same 16px padding on every axis at every level; section gaps equal row gaps, so proximity carries no meaning | The spacing scale with distinct steps: row gap < group gap < section gap |
| 13 | **The Squish Reflex** | `scale: 0.96` press feedback on *every* touchable - including full-width list rows - or `TouchableOpacity`'s washed-out flash | Rows highlight (background change); buttons scale slightly or dim; `Pressable` with per-role feedback. Never `TouchableOpacity` |
| 14 | **The Grand Entrance** | Staggered `FadeInDown.delay(i * 100)` on every list and screen, replaying on every visit | Entrance animation only for rare/first-time moments (`expo-animation`'s frequency gate); routine screens just appear |
| 15 | **The Onboarding Carousel** | Generic promotional slides delay the first useful screen without collecting required setup or teaching necessary concepts | Start with useful content and contextual guidance; retain onboarding that serves required setup or the user's brief |
| 16 | **Cross-Platform Costume** | One platform wearing the other's uniform: a FAB or ripple in an iOS-idiom app; iOS back-chevrons, large titles, or iOS-styled switches on Android | Each platform gets its own HIG's idiom - or a deliberate, documented platform-neutral treatment |
| 17 | **Safe-Area Collision** | Content under the notch/Dynamic Island or home indicator - or hand-patched with `marginTop: 50` | Headers/tab bars handle it; otherwise `contentInsetAdjustmentBehavior="automatic"` or safe-area-context insets |
| 18 | **Dark-Mode Amnesia** | Hardcoded `#fff` / `#000` / gray hexes; the app breaks - or half-breaks - the moment the OS theme flips | Semantic colors (`Color.ios.*` / `Color.android.dynamic.*`) through the theme; brand colors as declared light/dark pairs |
| 19 | **The Spinner Blink** | A full-screen centered `ActivityIndicator` between every state, or "No items yet" flashing while the first fetch resolves | Four-state screens (see `expo-data-fetching`): loading ≠ empty, keep stale content while revalidating, `RefreshControl`, skeletons for slow initial loads with a known layout |
| 20 | **Keyboard Blindness** | The focused input or the submit button disappears behind the keyboard; buttons above a keyboard need two taps | `react-native-keyboard-controller` tracks the real keyboard frame (`expo-animation` keyboard recipe); `keyboardShouldPersistTaps="handled"` for forms/search, `"always"` when unhandled taps must also keep the keyboard open |

For confirmation choices, follow [Apple’s alert guidance](https://developer.apple.com/design/human-interface-guidelines/alerts): uncommon irreversible actions warrant confirmation; routine undoable actions generally do not.

## Grep the greppable tells

Same shell-variable convention as `audit.md` (set `$SRC` and `$THEME` first, run from the repo root). These searches find candidates, not verified defects. Two hit classes:

- **review-each** - legitimate uses exist; check each hit against the tell's description.
- **advisory** - hits only suggest the tell; confirm on a screenshot.

> Inspect the indicated project files using the harness file tools or Node.js filesystem APIs. This upstream shell example is omitted in the portable distribution.

`audit.md` §1 finds related token candidates for #18 Dark-Mode Amnesia, #12 16-Everything, and #8 Shadowboxing. Token compliance does not prove readable dark mode, useful spacing hierarchy, or restrained shadows; inspect the rendered screen too.

Screenshot-only tells (no source search precise enough to trust): #2 X-Button Sheet, #7 Everything's a Card, #9 Wireframe Borders, #15 Onboarding Carousel, #16 Cross-Platform Costume, #17 Safe-Area Collision. Three more need a running app: #14 The Grand Entrance (re-enter a screen), #19 The Spinner Blink (watch the first load and a refetch), #20 Keyboard Blindness (keyboard open). Check them per `SKILL.md`'s Self-Critique Pass, #16 on both platforms.

## Growing the list

A new tell earns its place only after the same failure appears repeatedly across generations - one model's one-off quirk stays out until it repeats. Keep the list near 20 entries: recognition degrades with length.
