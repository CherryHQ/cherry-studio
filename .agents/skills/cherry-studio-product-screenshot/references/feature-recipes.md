# Feature Recipes

These recipes describe repeatable state preparation, not fixed user data. Confirm every visible string and asset against the current reference before capture.

## Shared locale and tab matrix

- Switch theme and language through Settings > Appearance. Theme or route changes can remount the page and reset local scroll positions.
- Task and route tab titles created in one locale do not always translate later. Reopen or replace the affected tab in the target locale.
- For the established six-tab marketing set, use Chat, Agent, Code Mate, the current feature, Apps, and Notes. Put Chat first and Agent second.
- Opening a global-search result appends a tab. Use `cdp_target.mjs drag-aria` and `close-tab` to reorder and remove only verified duplicates.
- `close-tab` supports both `Close Tab` and `关闭标签页`.

## Chat

- Find the exact user message through global search, then use the visible jump-to-message control.
- Select the referenced assistant, choose Assistant display mode, and collapse all child conversations.
- Scroll the locale's first assistant (`Cherry助手` or `Cherry Assistant`) to the top of the assistant list.
- Keep the request, assistant attribution, meaningful result, and input bar visible. Inspect chart hover controls separately for each reference.

## Agent

- Find the exact task request through global search and verify the output filename or artifact marker before capture.
- Close the right Files panel when the reference has no file sidebar.
- Verify the panel is actually absent before capture; a correct task can still be composed incorrectly when Files remains open.
- Select the referenced agent, collapse child tasks, and align the locale's root agent (`Cherry助理` or `Cherry Agent`) at the top.
- Keep the request, completion summary, artifact card, and input bar in one frame.

## Knowledge Base

- Replace the fourth feature tab with Knowledge Base so the surrounding top-tab order remains stable.
- Select the exact knowledge base by visible name. Allow relative timestamps such as `27 days ago` to advance naturally.
- If the target item is outside the viewport, scroll it into view before dispatching a mouse click. A CDP click at an off-screen coordinate is not evidence that selection changed.
- Verify content markers from the target dataset, such as a distinctive folder and filename, before capture.
- Verify list filenames and column labels are in the target locale.

## Paintings

- Select the exact historical asset by its real thumbnail or file identity; visually similar generations are not substitutes.
- The history strip may be scrolled, so compare the full asset rather than guessing from the last visible thumbnail.
- Preserve the generated image and adjust only the real editable prompt field when the target locale requires localized current input.
- Confirm the model, size, image count, prompt, history selection, zoom state, and full composition.

## Model Provider

- Select the referenced provider and keep secrets masked.
- The provider detail is a nested scroller. Theme or route changes reset it; restore the reference offset after every remount.
- For the established CherryIN reference, an offset near `104` CSS pixels hides the account card while retaining API Key, API Host, and model groups.
- Match hover state per reference: some variants show the provider row's more menu, while others show the online indicator.
