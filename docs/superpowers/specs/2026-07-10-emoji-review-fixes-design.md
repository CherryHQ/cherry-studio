# Emoji Review Fixes Design

## Context

PR #16839 moves application emoji rendering to generated Fluent emoji artwork. Review found four issues:

- valid Unicode emoji without Fluent artwork are filtered from the picker and recent list, and existing persisted values are replaced at render time;
- the picker mounts every Fluent inline SVG when opened;
- `EmojiIcon` and `EmojiAvatar` were removed from the existing `@cherrystudio/ui` public entry points;
- `EmojiGlyph` applies `decorative` inconsistently between its Fluent and Unicode branches.

The accepted product behavior is that stored avatar values remain unchanged. Every application surface uses Fluent artwork when a mapping exists and displays the original Unicode emoji when it does not. The picker follows the same rendering rule.

## Goals

- Preserve every existing avatar and recent-emoji Unicode value.
- Render mapped emoji with Fluent artwork in all migrated application surfaces.
- Render unmapped but valid Unicode emoji natively instead of replacing or deleting them.
- Keep the picker responsive by mounting only visible emoji rows plus a small overscan.
- Preserve the existing root and components package imports for `EmojiIcon` and `EmojiAvatar`.
- Make `decorative` hide the complete `EmojiGlyph` subtree consistently.

## Non-goals

- Changing how avatar values are persisted.
- Migrating or rewriting existing user data.
- Guaranteeing Fluent artwork for emoji absent from the generated dataset.
- Replacing the generated inline-SVG dataset with a new asset pipeline in this PR.
- Adding search, category tabs, or other picker features.

## Behavior Contract

| Input | Stored value | Display |
| --- | --- | --- |
| Mapped Unicode emoji | unchanged | Fluent SVG artwork |
| Unmapped Unicode emoji | unchanged | original native Unicode glyph |
| Empty optional avatar | unchanged | caller-provided/default fallback |
| Non-emoji text avatar | unchanged | original text |

`EmojiGlyph` remains the single rendering boundary: it looks up Fluent artwork and falls back to Unicode text when no icon exists. `EmojiIcon`, `EmojiAvatar`, and renderer helpers must not pre-empt that fallback by substituting a different emoji.

The picker loads every valid emoji from groups 0 through 8. Recent emoji are deduplicated and capped as before, but are neither filtered by Fluent coverage nor rewritten on mount.

## Picker Rendering Design

The picker will flatten category content into two row kinds:

- category header rows;
- grid rows containing at most seven emoji.

`@tanstack/react-virtual`, already used in the repository, will virtualize those rows against the existing `Scrollbar` element. The virtualizer will render visible rows plus a small overscan, measure actual row heights, and include the active category header in its range so the current sticky-header behavior remains available.

This was selected over two alternatives:

- `content-visibility` still creates and parses every inline SVG, so it does not address the main opening cost;
- category-only lazy mounting is simpler but can still mount hundreds of SVGs for one large category.

The generated Fluent dataset remains in the dedicated `@cherrystudio/ui/fluent-emoji` entry. Asset-pipeline changes would add build and packaging risk beyond the review fix; row virtualization directly addresses the picker DOM and SVG parsing amplification identified by the reviewer.

## Public Package Compatibility

The dedicated Fluent entry remains the recommended import for new code. The previous lightweight `EmojiIcon` and `EmojiAvatar` implementations remain available from `@cherrystudio/ui` and `@cherrystudio/ui/components` as compatibility surfaces.

Restoring lightweight compatibility implementations is preferred to statically re-exporting the Fluent entry from the root barrel: a direct re-export would force the 2.9 MB Fluent dataset into root-entry module evaluation and undo the entry-point isolation introduced by this PR. Application call sites already migrated to `@cherrystudio/ui/fluent-emoji`, so product rendering still uses Fluent artwork.

Package tests will verify that the compatibility exports remain importable and preserve their previous native rendering contract.

## Accessibility

Both `EmojiGlyph` branches set `aria-hidden` on the outer span when `decorative` is true. The value is applied after spread props so a caller-provided accessible label cannot accidentally expose a decorative glyph. Non-decorative mapped glyphs retain the screen-reader-only Unicode identity, and non-decorative unmapped glyphs retain their visible Unicode text.

## Tests

Regression tests will be written before production changes and must first fail for the expected behavior:

- `EmojiGlyph`, `EmojiIcon`, and `EmojiAvatar` preserve family, skin-tone, and flag emoji without Fluent mappings;
- missing values still use the requested fallback;
- picker data retains valid unmapped emoji;
- recent emoji retain unmapped persisted values and accept them when pushed;
- mapped and unmapped decorative glyphs hide their outer wrapper;
- root and components package barrels continue exporting the compatibility components;
- picker virtualization receives the flattened row count and renders/clicks visible emoji rows without mounting the complete dataset.

After targeted tests pass, verification includes the UI package build, renderer type checking through repository checks, and the repository-required lint, test, format, and build-check commands.

## Risks and Mitigations

- Virtualization can break sticky category headers or scrolling measurements. Use the existing TanStack virtualizer pattern, measure rendered rows, and cover header inclusion in tests.
- Restoring compatibility components creates two intentional import surfaces. Documentation will continue to direct new Fluent consumers to the dedicated entry, while old imports retain their prior behavior.
- Unmapped emoji remain platform-dependent. This is the explicit compatibility fallback and is preferable to changing user-selected avatar identity.
