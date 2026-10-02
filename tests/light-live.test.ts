// Live-camera Light Meter: frame statistics, the honest verdict and camera error handling (no browser needed).
import { describe, expect, it, vi } from "vitest";
import { cameraProblem, CameraError, openRearCamera, stopStream } from "../src/app/data/camera.ts";
import { LIGHT_SOURCE_LABEL, analyzeLiveFrames, frameStats, type FrameStats } from "../src/shared/light.ts";

const solid = (v: number, n = 64 * 48) => { const a = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) a.set([v, v, v, 255], i * 4); return a; };
const frames = (f: FrameStats, k = 12) => Array.from({ length: k }, () => ({ ...f }));

describe("frame statistics", () => {
  it("computes luma mean, 95th percentile and clipped share", () => {
    expect(frameStats(solid(0))).toEqual({ mean: 0, p95: 0, clipped: 0 });
    const w = frameStats(solid(255));
    expect(w.mean).toBeCloseTo(1); expect(w.clipped).toBe(1);
    // Half dark, half saturated.
    const a = solid(10); a.set(solid(255, 64 * 24), 0);
    const s = frameStats(a);
    expect(s.clipped).toBeCloseTo(0.5); expect(s.p95).toBeCloseTo(1); expect(s.mean).toBeGreaterThan(0.4);
  });
});

describe("live verdict — honest by construction", () => {
  it("dark at the camera's limit → 'dark' (low light estimate)", () => {
    expect(analyzeLiveFrames(frames({ mean: 0.05, p95: 0.12, clipped: 0 }))).toEqual({ kind: "dark" });
  });
  it("a normally exposed scene is undetermined: auto-exposure hides the level", () => {
    expect(analyzeLiveFrames(frames({ mean: 0.45, p95: 0.8, clipped: 0.01 }))).toEqual({ kind: "undetermined", brightAreas: false });
  });
  it("very bright clipped areas are only a hint, never 'direct sun'", () => {
    const v = analyzeLiveFrames(frames({ mean: 0.6, p95: 1, clipped: 0.2 }));
    expect(v).toEqual({ kind: "undetermined", brightAreas: true });
    expect(JSON.stringify(v)).not.toContain("direct");
  });
  it("a dark frame with a bright window is high contrast, not a dim spot", () => {
    expect(analyzeLiveFrames(frames({ mean: 0.08, p95: 0.9, clipped: 0.06 })).kind).toBe("undetermined");
  });
  it("unreliable input: brightness jumping between frames → measure again", () => {
    const f = [...frames({ mean: 0.2, p95: 0.4, clipped: 0 }, 6), ...frames({ mean: 0.6, p95: 0.9, clipped: 0 }, 6)];
    expect(analyzeLiveFrames(f)).toEqual({ kind: "unstable" });
  });
  it("too few frames → no verdict", () => {
    expect(analyzeLiveFrames(frames({ mean: 0.5, p95: 0.8, clipped: 0 }, 3))).toEqual({ kind: "no_frames" });
    expect(analyzeLiveFrames([])).toEqual({ kind: "no_frames" });
  });
  it("never yields a number to show: verdicts carry no lux", () => {
    for (const v of [analyzeLiveFrames(frames({ mean: 0.05, p95: 0.1, clipped: 0 })), analyzeLiveFrames(frames({ mean: 0.5, p95: 0.9, clipped: 0.3 }))])
      expect(Object.values(v).some((x) => typeof x === "number")).toBe(false);
  });
  it("new sources are labelled as estimates", () => {
    expect(LIGHT_SOURCE_LABEL.camera_live_dark).toContain("לא מד אור מכויל");
    expect(LIGHT_SOURCE_LABEL.camera_live_user).toContain("הערכה שלך");
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
