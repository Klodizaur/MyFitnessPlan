# MyFitnessPlan for Android TV

A thin viewer: it asks for your computer's address once, remembers it, and shows
the web interface that the desktop app serves when **Share on Local Network** is on.
Nothing runs on the TV except this shell; plans, videos and the player all live on
the computer.

This is a separate Android project. It is not part of the desktop build and ships
on its own.

## Build

Needs JDK 17+ and the Android SDK (platform 35). With Android Studio, open this
`tv/` folder. From a terminal:

```sh
cd tv
echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties   # macOS default SDK path
./gradlew testDebugUnitTest assembleDebug
```

The APK is `app/build/outputs/apk/debug/app-debug.apk`.

## Release builds (signed with your own key)

Debug builds are signed with a throwaway key that differs per computer. A
release needs your own key, made once and kept safe (back it up): every future
update must be signed with the same key, or it won't install over the old app.

1. Make the key (once), from `tv/`:
   ```sh
   keytool -genkeypair -v -keystore myfitnessplan-release.jks -alias myfitnessplan \
     -keyalg RSA -keysize 4096 -validity 10000
   ```
2. Create `tv/keystore.properties` (ignored by git):
   ```
   storeFile=myfitnessplan-release.jks
   storePassword=…
   keyAlias=myfitnessplan
   keyPassword=…
   ```
3. Build: `./gradlew assembleRelease`, giving `app/build/outputs/apk/release/app-release.apk`.

A phone or TV that has the debug build installed needs it uninstalled once
before the first release build goes on (the keys differ).

## Install on a TV

1. On the TV: Settings → System (or Device Preferences) → About → click the build
   number seven times, then turn on **USB debugging** under Developer options.
2. On the computer (same Wi-Fi): `adb connect <tv-ip>` then
   `adb install -r app/build/outputs/apk/debug/app-debug.apk`.

## How the web interface knows it's on a TV

The WebView's user agent ends in `MyFitnessPlanTV/<version>`. The web interface
only switches to TV mode when it sees that marker, so browsers on computers, phones
and tablets are unaffected.
