# Android app (planned)

Intelli-Learn is a web app first. It can already be installed from the browser
on Android ("Add to Home screen" or "Install app" in Chrome) when it is served
over HTTPS, and then runs full screen and offline.

A real Android app, for the Play Store or for tablets without a server, is on
the roadmap. The plan is to wrap the same build with
[Capacitor](https://capacitorjs.com). **Capacitor is not installed in this
repository yet.** Only its configuration file, `capacitor.config.json`, is
here, so the steps below work without further decisions:

```json
{
  "appId": "com.techflicks.intellilearn",
  "appName": "Intelli-Learn",
  "webDir": "dist",
  "server": { "androidScheme": "https" }
}
```

`androidScheme: https` makes the WebView load the app from `https://localhost`.
That is a secure page, so the cryptography that protects the parent password
and the API key works inside the app exactly as it does in a browser.

## Adding Capacitor

Requirements: Node 22, [Android Studio](https://developer.android.com/studio)
with an Android SDK, and a JDK that your Android Studio version supports.

```bash
# 1. Add Capacitor to the project
npm i @capacitor/core @capacitor/cli @capacitor/android

# 2. Create the native Android project (writes the android/ folder)
npx cap add android

# 3. Build the web app into dist/
npm run build

# 4. Copy dist/ and the plugins into the Android project
npx cap sync android

# 5. Open it in Android Studio, then Run on a device or emulator
npx cap open android
```

After every change to the web code, repeat steps 3 and 4.

Notes:

- `npx cap init` is not needed: `capacitor.config.json` already exists.
- `android/` is listed in `.gitignore`. Decide whether to commit it once the
  native project has custom changes (icons, permissions, signing).
- For a release, set up signing in Android Studio (Build, "Generate Signed App
  Bundle or APK") and keep the keystore outside the repository.

## What changes inside a native app

| Topic | In the browser | In the Android app |
| --- | --- | --- |
| App files | Served by your server, cached by the service worker | Bundled in the app. No server is needed for the app itself |
| Service worker | Provides offline use and updates | Not needed. Updates arrive as app updates. Consider not registering it in native builds |
| Data | IndexedDB in the browser | IndexedDB in the app's WebView. Uninstalling the app deletes it, so backups matter just as much |
| AI in Direct mode | Subject to the browser's cross-origin rules | The same rules apply to the WebView. The AI service must still allow the app's origin (`https://localhost`) |
| AI in Proxy mode | `/ai-proxy/v1` on the app's own address | There is no "own address". Enter the full URL of a hosted proxy as the base URL, and add `https://localhost` to the proxy's `ALLOWED_ORIGINS` |
| Content-Security-Policy | Sent by nginx | Not sent by anyone. Add an equivalent `<meta http-equiv="Content-Security-Policy">` tag for native builds |

The last two rows need small code or configuration changes when the wrapper is
built. They are listed here so they are not forgotten.

## Native plugins to consider

The web build uses browser features for voice and for protecting the API key.
All three sit behind small interfaces, so a native plugin can replace the
browser implementation without touching the rest of the app.

### Speech recognition (speech to text)

- **Why:** The Android WebView does not provide the browser speech recognition
  API, so the microphone button would be unavailable in a plain wrapper.
- **Plugin:** `@capacitor-community/speech-recognition` (uses Android's speech
  recognizer and asks for the `RECORD_AUDIO` permission).
- **Where it plugs in:** `src/voice`. A provider implements the `VoiceDriver`
  interface from `src/voice/driver.ts` (`support`, `speak`, `stop`, `listen`,
  `finishListening`, `cancelListening`) and is activated with
  `setVoiceDriver(driver)` from `@/voice` at start-up. The rest of the app keeps
  calling `listenOnce()`.
- **Rules to keep:** record one utterance and release the microphone, reject
  only with `unsupported`, `denied` or `no-speech`, never store audio, and only
  listen while the child holds or taps the microphone button and the parent has
  enabled it.

### Text to speech

- **Why:** Speech output in a WebView depends on the device and is often
  missing or limited. A native plugin gives consistent voices and works offline.
- **Plugin:** `@capacitor-community/text-to-speech`.
- **Where it plugs in:** the same `VoiceDriver`. Its `speak(text, { rate,
  locale, onStart })` must resolve when speech ends or is stopped and must
  never reject. `stop()` must end speech immediately. One driver object can
  combine this plugin with the speech recognition plugin.

### Secure storage for the API key

- **Why:** On the web, a stored API key is encrypted with a key the browser
  keeps unreadable. On Android, the system Keystore is the stronger and more
  usual place for a secret.
- **Plugin:** a Keystore-backed secure storage plugin, for example
  `capacitor-secure-storage-plugin` or `@aparajita/capacitor-secure-storage`.
  Check that the one you choose is maintained and supports your Capacitor
  version.
- **Where it plugs in:** the key vault in `src/security/vault.ts`. The rest of
  the app only uses `setApiKey`, `getApiKey` and `hasApiKey` from `@/security`,
  so a native build can back those three functions with the plugin instead of
  IndexedDB. Keep the rule that backups never contain the key.
- **Still true:** in Direct mode the key is used on the device. Secure storage
  protects it at rest, not from someone with full control of the device. Proxy
  mode avoids having a key on the device at all.

### Detecting the native app

`Capacitor.isNativePlatform()` from `@capacitor/core` tells the app it runs in
the wrapper. Use it in one place at start-up to choose the voice driver and the
vault storage, and to skip service worker registration.

## Not planned for the wrapper

No analytics, advertising or crash-reporting SDKs. The rules in
`docs/PRIVACY_AND_SAFETY.md` apply to the Android app unchanged.
