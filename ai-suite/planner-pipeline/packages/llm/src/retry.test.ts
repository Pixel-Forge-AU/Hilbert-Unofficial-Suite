import { describe, expect, it, vi } from "vitest";
import { withRetry } from "./retry.js";

describe("withRetry", () => {
  it("retries up to the configured attempt count on failure", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("ok");

    const result = await withRetry(operation, { attempts: 3, baseDelayMs: 1, maxDelayMs: 5 });

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("stops retrying once the abort signal fires between attempts, instead of starting a fresh attempt", async () => {
    const controller = new AbortController();
    const operation = vi.fn().mockImplementation(async () => {
      // Simulates the abort landing *after* the first attempt fails but *before* the next
      // one would start - the real-world case a plain attempt-count retry loop misses.
      controller.abort(new Error("paused"));
      throw new Error("transient");
    });

    await expect(
      withRetry(operation, { attempts: 5, baseDelayMs: 1, maxDelayMs: 5, abortSignal: controller.signal })
    ).rejects.toThrow("transient");

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("throws immediately without calling the operation if already aborted before the first attempt", async () => {
    const controller = new AbortController();
    controller.abort(new Error("paused"));
    const operation = vi.fn();

    await expect(
      withRetry(operation, { attempts: 3, baseDelayMs: 1, maxDelayMs: 5, abortSignal: controller.signal })
    ).rejects.toThrow("paused");

    expect(operation).not.toHaveBeenCalled();
  });
});
