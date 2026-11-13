// yuan-Gym — the URL scheme this app answers to.
//
// The app was renamed from openGym to yuan-Gym. After the rename the native side (Android's
// AndroidManifest and iOS's Info.plist) and the widget / Siri / NFC code briefly kept the old
// `opengym` name while the web side wrote `yuan-gym://`; for a while both were accepted so
// already-shipped widgets and printed NFC stickers kept opening the app.
//
// This build drops the legacy `opengym` scheme entirely: the native widgets now emit
// `yuan-gym://`, the manifest only registers `yuan-gym`, and the parsers below accept only
// `yuan-gym`. Any old `opengym://` link in the wild will no longer open the app.

/** The scheme links are written with. */
export const APP_SCHEME = 'yuan-gym'

/** Every scheme the app accepts, as `URL.protocol` spells them (with the colon). */
export const APP_SCHEMES = ['yuan-gym:']

/** True when `url.protocol` (or a bare scheme) is one the app answers to. */
export const isAppScheme = proto => APP_SCHEMES.includes(String(proto || '').toLowerCase())
