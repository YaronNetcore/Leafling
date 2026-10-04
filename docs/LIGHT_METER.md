# Light Meter — live, automatic (2026-10-04)

## 1. Can the reference (native iOS) experience be reproduced in an iPhone PWA?
Partly. Reproduced: live in-app rear camera, a target circle, a reading that updates continuously while the phone
moves, an automatic plant-light category, saving to a personal plant. NOT reproducible: a lux value. The reference
app is native iOS and can read the camera's exposure duration, ISO and lens aperture from AVFoundation; those turn
the camera into a reflected-light meter (EV → lux). A PWA cannot read them.

## 2–4. What Leafling can access (verified against WebKit's `MediaTrackCapabilities.idl`, 2026-10)
| | iPhone Safari / Home-Screen PWA (all iOS browsers are WebKit) | Chromium (Android/desktop) |
|---|---|---|
| Live frames (getUserMedia → video → canvas) | yes | yes |
| width / height / frameRate / facingMode | yes | yes |
| focusDistance, whiteBalanceMode, zoom, torch, backgroundBlur, powerEfficient | yes (device-dependent) | partly |
| exposureMode / exposureTime / iso / exposureCompensation | **no** (not in WebKit at all) | on some devices; per spec `exposureTime` is meaningful only in manual mode |
| aperture | no | no |
→ Safari exposes no exposure metadata, so a defensible camera-based lux is **impossible** on iPhone. Leafling shows
no lux. The app's "פרטים טכניים" panel lists what the user's own browser actually exposes (nothing is stored).
On a Chromium device that does expose exposure data, Leafling still does not compute lux: it would need manual
exposure locking and a per-device calibration that has not been validated on a real device.

## 5. Measurement algorithm (`src/shared/light.ts`, `src/app/data/camera.ts`)
Auto-exposure multiplies the whole frame by one gain, so absolute pixel brightness is not illuminance — but the
RATIO between a lit and a shadowed part of the same frame survives it. Light = direct + diffuse; a shadow blocks
most of the direct part, so lit/shadow ≈ (direct + diffuse) / diffuse. This is the camera version of the
horticultural hand-shadow test.
Per sample (≈ 8 per second, only while the camera is live):
1. Target: the circle's bounding square is drawn into a 48×48 in-memory canvas; only pixels inside the circle count.
2. Each pixel → Rec.709 luma → sRGB-linearised → 3×3 box blur (texture is not a shadow).
3. lit/shadow ratio = (p95 + 0.004) / (p5 + 0.004); edge sharpness = 98.5th-percentile gradient / (p95 − p5).
4. Whole frame → 16×12 canvas → mean and p95 (the dark check).
The canvases are overwritten each sample and released when the camera stops. No image, frame or video is stored or sent.

## 6. Target region
The preview uses `object-fit: cover`, centred. The circle (42 % of the preview's shorter side, centred) maps to
the video through the cover scale factor, recomputed on every sample from the current video dimensions and the
on-screen box — so rotation and resolution changes are followed. Unit-tested (`targetInVideo`) and checked in the
browser: shadows visible only outside the circle do not change the reading.

## 7. Smoothing
Exponential moving average (time constant ≈ 0.7 s) of log2(ratio) and of sharpness; dark flag = majority of the
last 1 s; a new category must be the candidate for 0.6 s and cross its boundary by a 0.1 log2 margin (hysteresis).
Tested: a single odd frame does not flip the category; a sustained change does within ~1–2 s; flicker produces at
most a couple of changes in 3 s; the scale indicator moves less than 25 % per sample.

## 8. Automatic categories (never chosen by the user)
| Shown | Rule | Confidence |
|---|---|---|
| 🌑 אור חלש | whole frame dark at the camera's sensitivity limit | high |
| 🌫️ אין צל ברור בעיגול | ratio < 1.3 (no visible shadow — weak light, or no shadow in the circle) → saved as low | low |
| 🌥️ אור בינוני | 1.3 – 1.8 (faint, soft shadow) | medium |
| ☀️ אור חזק | 1.8 – 4, or ≥ 4 with a soft edge | medium |
| 🌞 אור ישיר | ≥ 4 **and** a crisp edge (sharpness ≥ 0.15) — "sun or a close lamp" | medium |
A bright frame alone never yields "direct": an even bright surface has no shadow and reads "no clear shadow".
Boundaries come from the direct/diffuse ratio (direct sun ≈ 4–10× the sky/room light; window light without sun
casts clear but soft shadows; deep in a room shadows are faint). They are physical approximations, not a calibration.

## 9. Calibration
None is possible for lux (no exposure data). The category thresholds are uncalibrated and must be confirmed on a real
iPhone in known conditions (below). Saved readings keep the raw relative signals (`relative.shadowContrast`,
`edgeSharpness`, `dark`, `noShadow`, `algorithm: shadow-contrast-v1`) so thresholds can be re-evaluated later.

## 10. Limitations compared with a native iOS app
No lux; needs a shadow in the circle (hand ~30 cm above the spot) — without one, bright and dim even surfaces look
alike; a close lamp also casts crisp shadows ("direct light", not necessarily sun); iPhone HDR/tone-mapping
compresses highlights (ratios in direct sun are under-estimated, still well above the threshold); only the dark
limit is an absolute signal.

## Real-iPhone acceptance checks (not yet done — Chromium emulation only so far)
1. Tools → מד אור (Home-Screen app and Safari): camera permission prompt; live preview inside Leafling; target circle.
2. Reading starts by itself; moving between a sunny sill, a bright room and a dark corner changes the scale and category.
3. Hand shadow in the circle: on a sunny sill → "אור ישיר"; near a north window → "אור חזק"/"אור בינוני"; deep in the room → "אור בינוני"/"אין צל ברור".
4. Phone covered / dark room → "אור חלש" with high confidence.
5. Reading is calm (no flicker) but follows a real change within ~2 s.
6. "פרטים טכניים" shows the capabilities (expected: no exposureTime/iso) — please send a screenshot.
7. "שייכי לצמח" shows only your plants; saving goes to that plant; leaving the screen turns off the green camera indicator.
8. No new photos in the plant gallery/journal after measuring.
