import type { Job } from "bullmq";
import { CreateEventRequestSchema } from "@implementation-orchestrator/contracts";
import { EventService } from "@implementation-orchestrator/orchestrator-core";

export function createEventRecordProcessor(eventService: EventService) {
  return async function processEventRecord(job: Job): Promise<{ wasNew: boolean }> {
    const payload = CreateEventRequestSchema.parse(job.data);
    const recorded = await eventService.record(payload);
    return { wasNew: recorded.wasNew };
  };
}
