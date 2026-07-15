# Emoji Picker Category Label Typography Design

## Goal

Make emoji picker category labels slightly smaller and remove their bold weight without changing category layout or sticky-label seam handling.

## Decision

Override the existing `.epr-emoji-category-label` rule with:

- `font-size: 14px`, matching the design system's body-sm size.
- `font-weight: var(--font-weight-regular)`, matching the regular UI label weight.

Keep the vendor-owned label height, padding, positioning, and line height unchanged. Preserve the existing `backdrop-filter` and `box-shadow` declarations that cover the sticky paint seam.

## Alternatives Considered

- `15px / regular` would be a subtler size reduction but introduces a non-standard intermediate size.
- `16px / regular` would remove bold styling but would not satisfy the request to make the text smaller.

## Verification

Extend the focused EmojiPicker test to assert the two typography declarations, then run only that renderer test file and file-scoped formatting checks.

## Success Criteria

- Category label text renders at 14px with regular weight.
- Vendor-owned category label geometry remains unchanged.
- The sticky seam guard remains intact.
