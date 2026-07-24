import { PrismaClient } from "@prisma/client";

let sharedClient: PrismaClient | undefined;

export function createPrismaClient(databaseUrl?: string): PrismaClient {
  return new PrismaClient(
    databaseUrl ? { datasources: { db: { url: databaseUrl } } } : undefined,
  );
}

export function getPrismaClient(): PrismaClient {
  if (!sharedClient) {
    sharedClient = createPrismaClient();
  }
  return sharedClient;
}

export async function disconnectPrismaClient(): Promise<void> {
  if (sharedClient) {
    await sharedClient.$disconnect();
    sharedClient = undefined;
  }
}
