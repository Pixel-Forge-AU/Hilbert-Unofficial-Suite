import { describe, expect, it } from "vitest";
import { BuilderGateway, UnknownBuilderProfileError } from "./gateway.js";
import { MockBuilderAdapter } from "./mock/mock-adapter.js";

describe("BuilderGateway", () => {
  it("resolves the adapter registered for a builder profile", () => {
    const mock = new MockBuilderAdapter();
    const gateway = new BuilderGateway({ mock });
    expect(gateway.resolve("mock")).toBe(mock);
  });

  it("throws for an unregistered builder profile", () => {
    const gateway = new BuilderGateway({ mock: new MockBuilderAdapter() });
    expect(() => gateway.resolve("openhands-local")).toThrow(UnknownBuilderProfileError);
  });
});
