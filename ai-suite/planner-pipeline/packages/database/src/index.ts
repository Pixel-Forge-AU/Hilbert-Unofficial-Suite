import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { plannerPrisma?: PrismaClient };

export const prisma =
  globalForPrisma.plannerPrisma ??
  new PrismaClient({
    log:
      process.env.LOG_LEVEL === "debug"
        ? ["query", "info", "warn", "error"]
        : ["warn", "error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.plannerPrisma = prisma;
}

export type { Prisma, Plan, StageExecution, Critique, PlanGateEvaluation, PlanArtifact } from "@prisma/client";
export { PrismaClient };
