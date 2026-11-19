# Agent Note: Voice recognition Off selection

Status: implemented

English | [中文](2026-11-14-voice-recognition-off-selection.zh.md)

## Problem

Local dictation needs an explicit Off state while Automatic retains its existing meaning. Before this change the only way to suppress input was a three-step workaround (unpin the composer tool, disable mouse hold, clear both hotkeys), and any missed step could still open the recorder — a privacy risk during screen sharing.

## Decision

Persist `off` in `feature.voice.recognition.model_id`. Only the renderer interprets it; the empty string still means Automatic and unknown nonempty model IDs remain unsupported. Off precedes Automatic in settings and disables recognition language and shortcut controls without clearing saved values. Download actions only navigate.

One utility and a derived hook hide dictation across composers, launcher panels, quick assistant, Notes and translation and disable keyboard and mouse gestures. Input, sending and microphone testing remain available. Lightweight windows preload the model preference.

`DictationService` gates every run before voice initialization or recording admission and owns the lifecycle-bound preference subscription. Admission reads the model id from the main process instead of the renderer cache, and an unreadable value blocks the run rather than falling back to the permissive default. Off synchronously invalidates the current generation before asynchronously cancelling pending, active or recovery work. Cancellation discards audio without transcription, abandons a microphone capture that has not resolved yet, and cannot cancel a newer run after On.

## Alternatives considered

- Add a preference key: unnecessary schema, default and seeding work for one enum-like choice.
- Reuse the empty string: conflicts with Automatic, which resolves an installed engine on its own.
- Hide buttons or stop recording: stale actions could still record, and stopping can transcribe captured audio.

## Consequences

Language and shortcut values survive Off; choosing an engine restores dictation. The model dropdown remains the only control, so no second state source exists. Older builds read `off` as an unsupported model ID rather than a disabled state. An already-open dictation submenu is not force-closed when Off arrives from another window; its entries only act on the run Off has already cancelled, so it cannot start a capture until dictation is switched back on. The product form was decided in #24552's triage decision card; this change implements it without a separate Spec PR.

## Verification

- Regression — `VoiceSettings.test.tsx` and `DictationShortcutSettings.test.tsx`: Off survives remount, choosing an engine restores the controls, language and shortcut values are retained, and a download entry only navigates.
- Regression — composer, unified panel, Notes, translation, quick assistant and gesture tests: no dictation entry is rendered while Off, entries and shortcuts return on On, and ordinary input and sending keep working.
- Regression — `VoiceService.test.ts`, `DictationService.test.ts` and `DictationService.streaming.test.ts`: the sentinel decodes to no preference, no admission or capture happens while Off, an active run is cancelled without transcription, and a newer On run survives the old read.
- Regression — focused renderer tests preserve Automatic resolution, unsupported model handling and microphone testing.
