import { describe, expect, it } from "vitest";
import type { Job } from "bullmq";
import { createRouter, type JobProcessor } from "./index.js";

function fakeJob(name: string, data: unknown): Job {
  return { name, data } as Job;
}

describe("job router", () => {
  it("dispatches to the processor registered for the job name", async () => {
    const calls: unknown[] = [];
    const registry: Record<string, JobProcessor> = {
      "event.record": async (job) => {
        calls.push(job.data);
        return { ok: true };
      },
    };
    const route = createRouter(registry);

    const result = await route(fakeJob("event.record", { id: "evt-1" }));

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([{ id: "evt-1" }]);
  });

  it("throws loudly for an unregistered job name instead of silently no-op'ing", async () => {
    const route = createRouter({});
    await expect(route(fakeJob("unknown.job", {}))).rejects.toThrow(
      "No processor registered for job name: unknown.job",
    );
  });
});
