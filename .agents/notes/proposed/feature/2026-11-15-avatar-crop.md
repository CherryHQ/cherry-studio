# Agent Note: Let the user frame an uploaded avatar

Status: proposed

English | [中文](2026-11-15-avatar-crop.zh.md)

## Problem

An uploaded avatar image is always cropped for the user. `prepareEntityImageBytes` (`src/renderer/utils/image.ts`) takes the largest centered square of the image and scales it to a 128×128 WebP. Agent and Assistant avatars (`prepareAvatarImage`, used by `AgentAvatarPicker`, `AssistantAvatarPicker`, and `DraftAgentAvatarPicker`) and the user avatar (`UserProfileEditor`) all go through it. In a wide or tall photo the face is often off-center, so the saved avatar cuts it off, and the only remedy is to crop the file in another app and upload it again.

## Proposal

- Choosing an image for an Agent, Assistant, or user avatar opens a crop dialog before anything is saved. The image sits under a fixed square frame (a circle for the user avatar, which is shown round). The user drags to move the image and zooms with a slider, the mouse wheel, a pinch, or the arrow keys.
- The frame starts on the largest centered square at zoom 1, so confirming without changes saves the same avatar as today.
- Confirming passes the framed region to `prepareEntityImageBytes`, which crops that region instead of the centered square and still writes a 128×128 WebP. Nothing else in the save path changes.
- Cancelling, pressing Escape, or closing the dialog saves nothing and keeps the current avatar.
- The dialog is a `createPopup` dialog (`src/renderer/services/popup`) so the existing async upload handlers can await it. Dragging and zooming come from `react-easy-crop` (MIT, one small dependency) instead of custom pointer code.
- The size check (10 MB) still runs before the dialog opens. Mini app icons and provider logos keep the automatic crop; they are logos, not avatars.

## Alternatives considered

- Keep the automatic center crop (rejected: the user cannot fix an off-center face).
- Write the drag and zoom by hand (rejected: pointer, wheel, pinch, and keyboard handling is what `react-easy-crop` already provides and tests).
- Crop inside the avatar popover instead of a dialog (rejected: the popover is too small to frame a photo, and it closes on outside clicks).
- Crop every uploaded image, logos included (rejected: logos are usually already square, and the extra step adds friction where nothing is gained).

## Acceptance criteria

- AC1 — Choosing an image for an Agent, Assistant, or user avatar opens the crop dialog with the image under a square frame (a circle for the user avatar), and nothing is saved until the user confirms (verification: renderer; owner: implementer)
- AC2 — Confirming without moving or zooming saves the same centered square the automatic crop produced (verification: unit; owner: implementer)
- AC3 — After moving or zooming, confirming saves exactly the framed region, scaled to 128×128 (verification: unit; owner: implementer)
- AC4 — Cancelling, pressing Escape, or closing the dialog saves nothing and keeps the previous avatar (verification: renderer; owner: implementer)
- AC5 — The dialog's zoom control works with the slider and the keyboard, and its strings exist in every locale (verification: renderer; owner: implementer)
- AC6 — In the app, an Agent avatar cropped in the edit dialog shows the framed region in the top bar and the profile pane (verification: Electron; owner: implementer)

## Risks

- Animated GIFs lose their animation, as they already do with the automatic crop, because the canvas writes one frame.
- `react-easy-crop` becomes a renderer dependency; it is bundled, so it adds a few KB to the renderer.
