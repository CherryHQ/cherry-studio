# Selection and Quick Assistant Model Navigation Design

## Status

Approved on 2026-08-20.

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

Validate the route search value. On arrival, scroll the requested row into view and apply a brief visual highlight, following the existing shortcut-settings focused-row behavior. A missing or invalid focus value renders the page normally.

### Quick assistant

When the quick assistant is in default-model mode:

- Show the effective current default assistant model beside the mode control.
- Add the same outline navigation button targeting `/settings/model?focus=default`.

Assistant mode retains its existing assistant selector and does not add a global-model navigation button because the selected assistant owns its model.

## Data flow and ownership

All displayed values come from the existing default-model hook and preferences. Navigation changes only renderer route state. No write occurs until the user selects a model on the global model settings page, which continues to own preference updates.

The selection settings should display effective models, not raw preference IDs. This matches runtime behavior when translation inherits the default model.

## Accessibility and localization

- Keep visible text labels on navigation buttons; do not rely on the arrow icon alone.
- Ensure model names remain readable and truncate only when space requires it.
- Add every new user-visible string to the English source catalog, synchronize catalogs, and provide real translations for every locale.
- Reuse existing model-setting labels and empty-state text where their meaning is identical.

## Verification

Add focused renderer tests that would fail if:

- Selection settings omit either effective model or send either navigation button to the wrong focused row.
- Translation model fallback is displayed differently from the model actually used.
- Quick assistant default-model mode omits the effective default model or navigation, or assistant mode incorrectly shows the global-model navigation.
- The model settings route accepts an unsupported focus value or fails to focus the requested row.

Run the closest affected Vitest files and `pnpm lint`. Interactive verification should confirm both selection-setting buttons and the quick-assistant button land on and highlight the correct global model row.

## Alternatives considered

### Inline model selectors

This is faster for model switching but duplicates the global editing surface and makes ownership less clear. It also encourages future settings pages to grow local selectors for the same preferences.

### A translation-only row

This addresses the original report but leaves explain, summarize, refine, and default-model custom actions equally opaque. Two rows describe the actual primary model ownership without exposing every auxiliary implementation detail as a separate control.

### Navigation without row focus

This requires less routing work, but the global page contains multiple model selectors and forces the user to rediscover the intended row. Focused navigation provides a precise destination while preserving the global page as the sole editor.
