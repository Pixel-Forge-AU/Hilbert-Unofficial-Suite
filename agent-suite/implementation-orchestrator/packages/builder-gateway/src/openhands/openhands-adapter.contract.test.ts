import { describe, expect, it } from "vitest";
import { OpenHandsAdapter } from "./openhands-adapter.js";

const baseUrl = process.env.OPENHANDS_BASE_URL;

describe.skipIf(!baseUrl)("OpenHandsAdapter (live contract test, requires OPENHANDS_BASE_URL)", () => {
  it("reports healthy against a real OpenHands agent server", async () => {
    const adapter = new OpenHandsAdapter({
      baseUrl: baseUrl!,
      sessionApiKey: process.env.OPENHANDS_SESSION_API_KEY,
      llmModel: process.env.OPENHANDS_LLM_MODEL ?? "unused-for-healthcheck",
      llmApiKey: process.env.OPENHANDS_LLM_API_KEY ?? "unused-for-healthcheck",
    });

    const health = await adapter.healthCheck();
    expect(health.healthy).toBe(true);
  });
});
