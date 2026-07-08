# Cherry Studio

Cherry Studio is a cross-platform AI desktop client. This context captures product language used across assistant, agent, chat, and user-facing surfaces.

## Language

**Avatar Emoji**:
An emoji chosen to represent a user, assistant, agent, or other resource in avatar and compact entity-icon surfaces. Its identity is the chosen Unicode emoji; visual rendering may vary as long as that identity is preserved.
_Avoid_: Icon ID, rendered asset, picker item

**Stable Emoji Option**:
An avatar emoji that can be selected for new avatars because Cherry Studio can render it consistently across supported platforms. It is a curated subset of avatar emoji, not a complete emoji catalogue; existing or imported avatar emoji that are not stable options remain valid avatar emoji.
_Avoid_: Supported Unicode emoji

**Stable Emoji Rendering**:
A display strategy that maps a stored Unicode avatar emoji to local Fluent Emoji Flat artwork when available, while preserving the Unicode value as the source of truth and falling back to Unicode for unmapped historical values.
_Avoid_: Emoji storage migration, icon-id avatar
