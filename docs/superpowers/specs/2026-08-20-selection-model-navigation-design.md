# Selection and Quick Assistant Model Navigation Design

## Status

Approved on 2026-08-20. The quick-assistant two-row layout and response-settings copy revisions were approved on
2026-08-20. Replacing the focused-row highlight with the provider model-pull arrow animation was approved on
2026-08-20.

## Context

The selection assistant settings expose toolbar, window, action, and advanced behavior, but do not show which models execute its AI actions. A user can therefore change the quick assistant's chat model and reasonably expect selection translation to follow it, even though translation uses the global translation model.

The current model ownership is intentional and should remain centralized:

- Selection translation generates its result with the global translation model.
- Automatic language detection can additionally use the global quick model. In `auto` mode it uses the model for short text and as an offline-detection fallback; `llm` mode always uses it.
- Explain, summarize, and refine use the global default assistant model.
- A custom AI action uses either the global default assistant model or the model bound to its selected assistant.
- Search, copy, and quote do not call a model.
- Quick assistant default-model mode uses the global default assistant model; assistant mode uses the selected assistant's model.

## Goals

- Make the effective models used by selection AI actions visible from the selection assistant settings.
- Give users a direct path to the authoritative global model selector.
- Make the quick assistant's default-model mode show which default model it will use and provide the same navigation path.
- Preserve the existing global model preferences and runtime routing.

## Non-goals

- Add local model selectors to the selection or quick assistant settings.
- Change which model any action uses.
- Add new preferences, persistence, IPC, or model-resolution fallbacks.
- Expose the quick model as a third primary selection-action model. It is an auxiliary dependency of language detection and will be disclosed in the translation row description.

## User experience

### Selection assistant

Add two setting rows at the top of the existing selection actions card, after its title controls and before the toolbar preview and draggable action list:

1. **Default assistant model**
   - Description: used by explain, summarize, refine, and custom actions configured to use the default model.
   - Show the effective current default model.
   - Provide an outline button with an `ArrowRight` icon that navigates to the default assistant model row in global model settings.
2. **Translation model**
   - Description: used to generate selection translations; automatic language detection may additionally use the quick model.
   - Show the effective current translation model, including its fallback to the default model when no dedicated translation model is selected.
   - Provide the same navigation button targeting the translation model row in global model settings.

This placement associates model ownership with executable actions. Putting the rows in the enable, toolbar, or window cards would imply that one model powers the whole feature or controls presentation behavior.

The navigation control should follow the established web-search provider-settings pattern: an outline button with an `ArrowRight` icon and an explicit localized label. The displayed model is read-only so the global model page remains the single editing surface.

If an effective model cannot be resolved, show the existing localized empty-model label and keep navigation available.

### Global model settings

Support focused navigation through the model settings route:

- `/settings/model?focus=default`
- `/settings/model?focus=translate`

Validate the route search value. On arrival, scroll the requested row into view and briefly point to its model selector. A
missing or invalid focus value renders the page normally.

The shortcut-settings precedent remains the navigation contract: validate a stable identifier at the route boundary,
scroll the matching row into view, and leave the user at the scrolled position. Instead of tinting the entire row, place an
`ArrowRight` immediately before the focused row's model selector and reuse the provider model-pull guide animation. The
arrow fades in while moving toward the selector, briefly rebounds, and fades out over 1.2 seconds. This points to the
editable control rather than merely identifying its containing row and avoids leaving a visual state behind.

The arrow is transient and decorative: it does not take focus, receive pointer events, or add an accessible name. Keep its
implementation local to model settings because it is coupled to the row's selector layout. Do not extract the provider
model-pull guide into shared UI for only two consumers.

### Quick assistant

Present model-source selection and source-specific configuration as a titled response-settings group inside the
quick-assistant page:

1. The group title is **Response settings**. This avoids repeating the page's **Quick assistant** title while covering
   both assistant-backed and default-model-backed responses.
2. The first row is **Usage method** and contains only the existing segmented control for **Use assistant** and
   **Default model**.
3. After a divider, the second row reflects the selected mode:
   - Assistant mode labels the row **Select assistant**, places the existing assistant-mode tooltip immediately after
     that label, and shows the existing assistant selector.
   - Default-model mode labels the row **Default assistant model**, shows the effective current default model, and provides the outline navigation button targeting `/settings/model?focus=default`.

The mode control is the parent decision and must precede the configuration it controls. Do not place the model, navigation button, and segmented control in one horizontal cluster. Keep the explicit navigation label rather than reducing it to an icon-only button: it is a deliberate cross-page action and matches the web-search provider-settings precedent.

The assistant-mode tooltip says that using an assistant also applies its system prompt and model parameters. It belongs
beside **Select assistant**, not beside **Usage method**, because it is relevant only while assistant mode is active. The
default-model row does not show this tooltip.

Assistant mode does not show a global-model navigation button because the selected assistant owns its model. Existing behavior remains unchanged when no assistants exist, while assistants are loading, or when a saved assistant has been deleted: the assistant option is disabled when unavailable, a loading selection is preserved, and an invalid loaded selection falls back to default-model mode.

Both rows may wrap at narrow widths, but each row keeps one responsibility. Model and assistant names truncate before the mode control or navigation action becomes unusable.

## Data flow and ownership

All displayed values come from the existing default-model hook and preferences. Navigation changes only renderer route state. No write occurs until the user selects a model on the global model settings page, which continues to own preference updates.

The selection settings should display effective models, not raw preference IDs. This matches runtime behavior when translation inherits the default model.

## Accessibility and localization

- Keep visible text labels on navigation buttons; do not rely on the arrow icon alone.
- Give the response-settings group a visible title and retain a distinct accessible label for the usage-method control.
- Associate the assistant-mode tooltip with the **Select assistant** label and render it only in assistant mode.
- Mark the focused-row arrow as hidden from assistive technology and disable its motion when reduced motion is requested.
- Ensure model names remain readable and truncate only when space requires it.
- Add every new user-visible string to the English source catalog, synchronize catalogs, and provide real translations for every locale.
- Reuse existing model-setting labels and empty-state text where their meaning is identical.

## Verification

Add focused renderer tests that would fail if:

- Selection settings omit either effective model or send either navigation button to the wrong focused row.
- Translation model fallback is displayed differently from the model actually used.
- Quick assistant default-model mode omits the effective default model or navigation, or assistant mode incorrectly shows the global-model navigation.
- Quick assistant renders the usage-method selector and source-specific configuration as one ambiguous control cluster
  instead of a titled group with separate setting rows.
- Quick assistant shows the assistant-only tooltip beside the usage-method row or in default-model mode.
- The model settings route accepts an unsupported focus value or fails to focus the requested row.
- The requested row omits the temporary selector arrow or renders an arrow on a non-requested row.

Run the closest affected Vitest files and `pnpm lint`. Interactive verification should confirm both selection-setting
buttons and the quick-assistant button land on the correct global model row and point to its selector.

## Alternatives considered

### Inline model selectors

This is faster for model switching but duplicates the global editing surface and makes ownership less clear. It also encourages future settings pages to grow local selectors for the same preferences.

### A translation-only row

This addresses the original report but leaves explain, summarize, refine, and default-model custom actions equally opaque. Two rows describe the actual primary model ownership without exposing every auxiliary implementation detail as a separate control.

### Navigation without row focus

This requires less routing work, but the global page contains multiple model selectors and forces the user to rediscover the intended row. Focused navigation provides a precise destination while preserving the global page as the sole editor.

### Whole-row background and ring

Tinting the row makes the destination easy to find, but it identifies a container rather than the control the user should
operate. It also introduces a second focus treatment beside the provider model-pull guide. Reusing the short arrow motion
keeps the interaction language consistent and points directly to the selector.

### Arrow plus row tint

Combining the arrow with a subtle background provides the strongest locator, but the two effects communicate the same
thing and create unnecessary emphasis on a settings page. The arrow alone is sufficient after scrolling the row into view.

### Reordering the quick-assistant controls within one row

Placing the segmented control before the current model improves reading order and requires fewer layout changes, but long model names, translated button labels, and the assistant selector still compete for one horizontal row. Splitting mode and configuration into two rows adds one divider and one row of height in exchange for clearer ownership and more robust sizing.

### Quick-assistant group title

**Quick assistant configuration** repeats the page title, while **Models and assistants** reads like a field inventory.
**Response settings** is concise, already matches Cherry Studio product language, and accurately covers both available
response sources. The first row keeps the separate **Usage method** label so the segmented control remains understandable
and accessible outside the heading context.
