import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("planner API app", () => {
  it("returns health status", async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({ method: "GET", url: "/health" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });

  it("returns a validation error for invalid plan creation input", async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/plans",
        payload: { title: "", brief: "" }
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");
    } finally {
      await app.close();
    }
  });

  it("exposes Prometheus metrics", async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({ method: "GET", url: "/metrics" });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("planner_jobs_total");
    } finally {
      await app.close();
    }
  });
});
