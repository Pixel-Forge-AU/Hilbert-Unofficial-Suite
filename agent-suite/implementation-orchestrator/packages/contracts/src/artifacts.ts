import { z } from "zod";

export const ArtifactTypeSchema = z.enum([
  "manifest",
  "repository_profile",
  "compiled_task_graph",
  "builder_transcript",
  "builder_patch",
  "command_output",
  "test_report",
  "verification_log",
  "git_diff",
  "changed_file_list",
  "workflow_summary",
]);
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

export const ArtifactStorageProviderSchema = z.enum(["filesystem", "minio", "s3"]);
export type ArtifactStorageProvider = z.infer<typeof ArtifactStorageProviderSchema>;

export const ArtifactReferenceSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  taskId: z.string().nullable().optional(),
  attemptId: z.string().nullable().optional(),
  artifactType: ArtifactTypeSchema,
  storageProvider: ArtifactStorageProviderSchema,
  storageKey: z.string(),
  contentHash: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string(),
});
export type ArtifactReference = z.infer<typeof ArtifactReferenceSchema>;
