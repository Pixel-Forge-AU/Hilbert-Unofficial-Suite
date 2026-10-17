import { describe, expect, it } from "vitest";
import type { Job } from "bullmq";
import type { EventService } from "@implementation-orchestrator/orchestrator-core";
import { createEventRecordProcessor } from "./event-record.js";

function fakeJob(data: unknown): Job {
  return { data } as Job;
}

describe("event.record processor", () => {
  it("parses the job payload and delegates to EventService.record", async () => {
    const recordedCalls: unknown[] = [];
    const fakeEventService = {
      record: async (event: unknown) => {
        recordedCalls.push(event);
        return { wasNew: true } as never;
      },
    } as unknown as EventService;

    const processor = createEventRecordProcessor(fakeEventService);
    const result = await processor(
      fakeJob({
        id: "evt-1",
        type: "workflow.created",
        workflowId: "wf-1",
        source: "test",
        payload: { hello: "world" },
      }),
    );

    expect(result).toEqual({ wasNew: true });
    expect(recordedCalls).toHaveLength(1);
  });

  it("rejects a malformed payload before calling EventService", async () => {
    const fakeEventService = {
      record: async () => {
        throw new Error("should not be called");
      },
    } as unknown as EventService;

    const processor = createEventRecordProcessor(fakeEventService);
    await expect(processor(fakeJob({ id: "evt-1" }))).rejects.toThrow();
  });
});
