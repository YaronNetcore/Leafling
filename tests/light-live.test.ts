// Live AUTOMATIC Light Meter: target statistics, continuous smoothing/categories, circle mapping, camera errors.
import { describe, expect, it, vi } from "vitest";
import { cameraProblem, CameraError, openRearCamera, stopStream, targetInVideo } from "../src/app/data/camera.ts";
import { AUTO_LABEL, LIGHT_SOURCE_LABEL, LightSmoother, analyzeTarget, frameLevel, savedCategory, shadowContrast, type LiveSample } from "../src/shared/light.ts";

const W = 48;
/** Synthetic target patch: value(x, y) in sRGB bytes. */
const patch = (f: (x: number, y: number) => number) => { const a = new Uint8ClampedArray(W * W * 4); for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const v = f(x, y); a.set([v, v, v, 255], (y * W + x) * 4); } return a; };
const t = (f: (x: number, y: number) => number) => analyzeTarget(patch(f), W, W);
const sample = (f: (x: number, y: number) => number, frame = { mean: 0.2, p95: 0.6 }): LiveSample => ({ target: t(f), frameMean: frame.mean, frameP95: frame.p95 });
const run = (s: LiveSample, ms = 3000, step = 125, sm = new LightSmoother()) => { let st = sm.push(s, 0); for (let tt = step; tt <= ms; tt += step) st = sm.push(s, tt); return st; };
const crisp = (x: number) => (x < 24 ? 55 : 215); // deep shadow with a sharp edge (direct light)
const soft = (x: number) => Math.round(215 - (215 - 135) * Math.min(1, Math.max(0, (x - 4) / 40))); // wide penumbra, clear shadow
const faint = (x: number) => Math.round(215 - (215 - 182) * Math.min(1, Math.max(0, (x - 4) / 40)));
const even = () => 180;

describe("target statistics (linear light, circle only)", () => {
  it("lit/shadow ratio and edge sharpness behave physically", () => {
    expect(shadowContrast(t(even))).toBeCloseTo(1, 1);
    expect(shadowContrast(t(crisp))).toBeGreaterThan(5);
    expect(t(crisp).sharp).toBeGreaterThan(0.15);
    expect(shadowContrast(t(soft))).toBeGreaterThan(1.8);
    expect(t(soft).sharp).toBeLessThan(0.15);
    expect(shadowContrast(t(faint))).toBeGreaterThan(1.3);
    expect(shadowContrast(t(faint))).toBeLessThan(1.8);
  });
  it("only the circle counts: a shadow in the corners outside the circle is ignored", () => {
    const corners = (x: number, y: number) => ((x - 23.5) ** 2 + (y - 23.5) ** 2 > 26 ** 2 ? 20 : 200);
    expect(shadowContrast(t(corners))).toBeLessThan(1.15);
  });
  it("auto-exposure invariance: the same scene at a different overall gain gives the same ratio", () => {
    const g1 = t((x) => (x < 24 ? 70 : 200)), g2 = t((x) => (x < 24 ? 45 : 140));
    expect(Math.abs(Math.log2(shadowContrast(g1)) - Math.log2(shadowContrast(g2)))).toBeLessThan(0.5);
  });
  it("frame level for the dark check", () => {
    const dark = new Uint8ClampedArray(16 * 12 * 4).fill(10);
    expect(frameLevel(dark).mean).toBeLessThan(0.012);
  });
});

describe("continuous automatic classification", () => {
  it("deep crisp shadow → direct light; clear soft shadow → strong; faint → medium; none → no clear shadow", () => {
    expect(run(sample(crisp)).category).toBe("direct");
    expect(run(sample(soft)).category).toBe("bright_indirect");
    expect(run(sample(faint)).category).toBe("medium");
    expect(run(sample(even)).category).toBe("no_shadow");
  });
  it("a merely BRIGHT frame without a shadow is never 'direct'", () => {
    expect(run(sample(() => 250, { mean: 0.8, p95: 1 })).category).toBe("no_shadow");
  });
  it("a deep but SOFT shadow is strong light, not direct", () => {
    const deepSoft = (x: number) => Math.round(220 - (220 - 50) * Math.min(1, Math.max(0, (x - 2) / 44)));
    expect(run(sample(deepSoft)).category).toBe("bright_indirect");
  });
  it("dark at the camera's limit → low light with high confidence; categories are automatic", () => {
    const st = run(sample(even, { mean: 0.004, p95: 0.02 }));
    expect(st).toMatchObject({ category: "low", confidence: "high", dark: true });
    expect(run(sample(crisp)).confidence).toBe("medium"); // never 'high' for uncalibrated shadow readings
    expect(run(sample(even)).confidence).toBe("low");
  });
  it("updates continuously when the scene changes, but not on single-frame noise (hold + hysteresis)", () => {
    const sm = new LightSmoother();
    let st = run(sample(soft), 2000, 125, sm);
    expect(st.category).toBe("bright_indirect");
    // One odd frame does not flip the category.
    st = sm.push(sample(even), 2125);
    st = sm.push(sample(soft), 2250);
    expect(st.category).toBe("bright_indirect");
    // A sustained change does — within about a second.
    let tt = 2250, changedAt = -1;
    for (let i = 0; i < 30; i++) { tt += 125; st = sm.push(sample(crisp), tt); if (st.category === "direct" && changedAt < 0) changedAt = tt; }
    expect(changedAt).toBeGreaterThan(0);
    expect(changedAt - 2250).toBeLessThan(2000);
  });
  it("the indicator moves smoothly (bounded change per frame), and never carries a lux value", () => {
    const sm = new LightSmoother();
    let prev = run(sample(even), 2000, 125, sm).position;
    let maxStep = 0;
    for (let i = 1; i <= 20; i++) { const st = sm.push(sample(crisp), 2000 + i * 125); maxStep = Math.max(maxStep, Math.abs(st.position - prev)); prev = st.position; }
    expect(maxStep).toBeLessThan(0.25);
    expect(prev).toBeGreaterThan(0.6);
    const st = run(sample(crisp));
    expect(Object.keys(st).some((k) => /lux/i.test(k))).toBe(false);
  });
  it("labels and what is saved", () => {
    expect(savedCategory("no_shadow")).toBe("low");
    expect(AUTO_LABEL.direct.title).toBe("אור ישיר");
    expect(LIGHT_SOURCE_LABEL.camera_live_auto).toContain("לא לוקס");
  });
});

describe("target circle ↔ video pixels", () => {
  it("maps the centred circle through object-fit: cover", () => {
    // 640×480 landscape video in a 300×400 portrait box: cover scale = max(300/640, 400/480) = 0.8333.
    const g = targetInVideo(640, 480, 300, 400, 150);
    expect(g.size).toBeCloseTo(180, 0);
    expect(g.sx).toBeCloseTo(230, 0);
    expect(g.sy).toBeCloseTo(150, 0);
    // Portrait video (rotated phone) in the same box.
    const p = targetInVideo(480, 640, 300, 400, 150);
    expect(p.sx + p.size / 2).toBeCloseTo(240, 0);
    expect(p.sy + p.size / 2).toBeCloseTo(320, 0);
  });
});

describe("camera access", () => {
  it("maps getUserMedia errors to what the user can do", () => {
    expect(cameraProblem(new DOMException("x", "NotAllowedError"))).toBe("denied");
    expect(cameraProblem(new DOMException("x", "SecurityError"))).toBe("denied");
    expect(cameraProblem(new DOMException("x", "NotFoundError"))).toBe("no_camera");
    expect(cameraProblem(new DOMException("x", "OverconstrainedError"))).toBe("no_camera");
    expect(cameraProblem(new DOMException("x", "NotReadableError"))).toBe("busy");
    expect(cameraProblem(new Error("?"))).toBe("failed");
    expect(cameraProblem(new CameraError("unsupported"))).toBe("unsupported");
  });
  it("no secure context / no mediaDevices → unsupported (never a fallback to photo capture)", async () => {
    vi.stubGlobal("window", { isSecureContext: false });
    await expect(openRearCamera()).rejects.toMatchObject({ problem: "unsupported" });
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", {});
    await expect(openRearCamera()).rejects.toMatchObject({ problem: "unsupported" });
    vi.unstubAllGlobals();
  });
  it("asks for the rear camera without audio, and stopStream stops every track", async () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }, { stop }] } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    expect(await openRearCamera()).toBe(stream);
    expect(getUserMedia.mock.calls[0][0]).toMatchObject({ audio: false, video: { facingMode: { ideal: "environment" } } });
    stopStream(stream);
    expect(stop).toHaveBeenCalledTimes(2);
    getUserMedia.mockRejectedValueOnce(new DOMException("x", "NotAllowedError"));
    await expect(openRearCamera()).rejects.toMatchObject({ problem: "denied" });
    vi.unstubAllGlobals();
    stopStream(null); // harmless
  });
});
