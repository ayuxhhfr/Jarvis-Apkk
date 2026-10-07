# JARVIS Hybrid TS + Kotlin Architecture Audit

Date: 2026-10-07
Base: main @ 9c678b154406101ce5dbebd7d9ca7e8d1967fe8d
Protected backup: BACKUP-before-TS-Kotlin-major-implementation-2026-10-07 @ 9c678b154406101ce5dbebd7d9ca7e8d1967fe8d

## Baseline findings

- The repository default branch is `main`.
- The protected backup points to the same commit as main at audit time.
- The committed Android source is under `android-native/`; a generated Capacitor `android/` project is not committed.
- The current Android bridge is a Java Capacitor plugin named `MyJarvisSpeech`.
- The Java plugin already contains AudioRecord-based 16 kHz mono 16-bit PCM capture, Android SpeechRecognizer wake-word support, TTS, app launching and clipboard access.
- TypeScript already has Android runtime orchestration in `src/services/androidRuntime.ts` and app launching in `src/services/androidAppActions.ts`.
- Gemini Live is currently a TypeScript WebSocket service. Android connects directly to Google's Live WebSocket rather than using the VPS.
- The current Live service already buffers user transcription fragments before exposing a completed utterance.
- Browser/Web playback is still handled by `src/services/audioManager.ts`; Android input is native, but Android output is not yet a Kotlin AudioTrack pipeline.
- The current memory storage key is `jarvis_long_term_memories`. Memory persistence has rollback-on-localStorage-failure behavior and deduplication.
- Memory learning currently performs quick rule-based extraction before asynchronous AI classification. This conflicts with the desired single authoritative Gemini 2.5 Flash-Lite classifier path and will be normalized in a later phase.
- No `.github/workflows/` directory exists on main. Earlier APK-build branches contain temporary workflows that generate a Capacitor Android project and copy the committed native Java bridge into it.
- `package.json` currently uses Vite 8.3.x and esbuild 0.28.x; the repository's previous Android-build workflow used `npm install --legacy-peer-deps` because dependency resolution has been a known build concern.
- The UI is already substantially componentized around the existing JARVIS globe, chat, settings, memory dashboard, browser and voice controls. The hybrid upgrade should preserve these components rather than replacing them.

## Target boundary

### TypeScript / React
UI, globe visualization, chat rendering, settings, memory dashboard, application state, high-level orchestration and normal Gemini requests.

### Kotlin / Android
Realtime microphone capture, AudioTrack output, PCM buffering, VAD, barge-in, audio focus, lifecycle, foreground-service integration and Android system actions.

### Gemini
- Normal brain: existing configured chat model, currently `gemini-3.5-flash` in the repository.
- Realtime voice: `gemini-3.1-flash-live-preview`.
- Memory classification: `gemini-2.5-flash-lite` only.

### VPS
Optional server-side search/extraction, secure proxying, heavy processing and persistent tasks. Basic Gemini and Live traffic remain direct unless a concrete security requirement requires a backend.

## Implementation constraints

1. Do not modify the protected backup branch.
2. Do not replace the existing visual UI.
3. Do not claim native functionality until it is implemented and build-tested.
4. Keep one authoritative native bridge instead of scattered Capacitor calls.
5. Keep realtime audio work off the React main thread.
6. Emit throttled semantic native events to React.
7. Preserve the memory key `jarvis_long_term_memories`.
8. Make each major phase independently buildable and reviewable.
