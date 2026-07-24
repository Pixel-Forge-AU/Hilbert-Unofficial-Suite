import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@implementation-orchestrator/database";
import { sha256Hex, type ArtifactReference, type ArtifactType } from "@implementation-orchestrator/contracts";

export interface StoreArtifactInput {
  workflowId: string;
  taskId?: string;
  attemptId?: string;
  artifactType: ArtifactType;
  data: unknown;
}

export class ArtifactService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storageRoot: string,
  ) {}

  async storeJson(input: StoreArtifactInput): Promise<ArtifactReference> {
    const content = JSON.stringify(input.data, null, 2);
    const contentHash = sha256Hex(content);
    const storageKey = path.posix.join(input.workflowId, `${input.artifactType}-${contentHash.slice(0, 16)}.json`);
    const fullPath = path.join(this.storageRoot, storageKey);

    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf8");

    const row = await this.prisma.artifact.create({
      data: {
        workflowId: input.workflowId,
        taskId: input.taskId,
        attemptId: input.attemptId,
        artifactType: input.artifactType,
        storageProvider: "filesystem",
        storageKey,
        contentHash,
        sizeBytes: Buffer.byteLength(content, "utf8"),
      },
    });

    return {
      id: row.id,
      workflowId: row.workflowId,
      taskId: row.taskId ?? undefined,
      attemptId: row.attemptId ?? undefined,
      artifactType: row.artifactType as ArtifactType,
      storageProvider: "filesystem",
      storageKey: row.storageKey,
      contentHash: row.contentHash,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
