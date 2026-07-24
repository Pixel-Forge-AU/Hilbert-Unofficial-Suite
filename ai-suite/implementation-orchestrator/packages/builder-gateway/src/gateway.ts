import type { BuilderAdapter } from "./adapter.js";

export class UnknownBuilderProfileError extends Error {
  constructor(builderProfile: string) {
    super(`No builder adapter registered for profile: ${builderProfile}`);
    this.name = "UnknownBuilderProfileError";
  }
}

export class BuilderGateway {
  constructor(private readonly adaptersByProfile: Record<string, BuilderAdapter>) {}

  resolve(builderProfile: string): BuilderAdapter {
    const adapter = this.adaptersByProfile[builderProfile];
    if (!adapter) {
      throw new UnknownBuilderProfileError(builderProfile);
    }
    return adapter;
  }
}
