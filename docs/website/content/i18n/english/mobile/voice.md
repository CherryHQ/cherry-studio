---
icon: mic
---

# Voice and audio transcription

Dictation turns live speech into a draft, transcription processes saved recordings, and read-aloud speaks an answer. Configure them separately in **Settings → Voice** rather than assuming one audio capability switch enables everything.

## Enable dictation

Dictation is off by default. In **Settings → Voice → Voice input**, choose:

| Engine | Requirements |
| --- | --- |
| System | An available recognition service, language, and requested OS permissions; the service may use the network |
| Offline | Download and verify **SenseVoiceSmall**, about 240 MB; follow the displayed size |
| Off | Keep the normal send workflow |

Downloads provide progress, cancellation, and retry. Install a package containing the native voice capabilities; a code-only update cannot necessarily enable a new engine.

## Dictate a message

1. Enable dictation. When the composer has nothing sendable and no reply is running, its primary action shows a microphone.
2. Tap to start and grant microphone/system-recognition permissions when requested.
3. Tap to stop and wait for recognition.
4. Review names, numbers, and punctuation, then send explicitly.

Recognition creates a draft. Starting or stopping recording does not send it to the chat model. With text/attachments to send or a running reply, the primary action serves sending or stopping instead; it is not a permanent hold-to-record button.

## Transcribe an existing recording

Choose an engine and recording language in **Settings → Voice → Audio file transcription**. Offline transcription needs the downloaded SenseVoice model. System transcription requires **offline file recognition** for that device/language and does not silently fall back to online recognition.

* Import a recording in **Files**, choose transcription from its menu, then open the saved text result.
* Alternatively, attach audio through **＋ → Files** in a local Standard conversation and ask for transcription or a summary of the transcript.
* Each audio file is limited to **100 MiB** and **2 hours**. The engine must still decode its format; renaming an extension does not convert it.

Audio attachments stay local. The model receives a reference for transcription and the resulting text, rather than gaining direct audio understanding. Summarizing that transcript still sends text to the selected model service.

Cancelling the page/task stops processing. Do not treat incomplete output as the complete recording; check important names and numbers against the source.

## Listen to an answer

Choose an available system voice in **Settings → Voice → Read aloud**, then start it from a completed answer's actions. You can stop playback. Languages and voices depend on installed device services.

Read-aloud can continue in the background where permitted, subject to audio, OS, and process limits. It is separate from [background generation](settings-and-usage.md).

## Missing microphone or failed transcription

Check that dictation is enabled, the composer has no pending content, no reply is running, and recognition services, permissions, offline downloads, and language support are available. Retry download/verification errors in settings instead of resubmitting the original chat task.
