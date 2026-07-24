import { z } from "zod";

export const DetectedLanguageSchema = z.object({
  name: z.string(),
  fileCount: z.number().int().nonnegative(),
});
export type DetectedLanguage = z.infer<typeof DetectedLanguageSchema>;

export const DetectedFrameworkSchema = z.object({
  name: z.string(),
  category: z.enum(["frontend", "backend", "fullstack", "testing", "build_tool"]),
  detectedFrom: z.string(),
});
export type DetectedFramework = z.infer<typeof DetectedFrameworkSchema>;

export const PackageManagerProfileSchema = z.object({
  name: z.enum(["npm", "pnpm", "yarn", "bun", "pip", "poetry", "composer", "cargo", "go"]),
  lockfile: z.string(),
  workspaceRoot: z.string(),
});
export type PackageManagerProfile = z.infer<typeof PackageManagerProfileSchema>;

export const DetectedCommandSchema = z.object({
  label: z.string(),
  command: z.string(),
  workingDirectory: z.string(),
  source: z.enum(["package_script", "convention", "config_file"]),
});
export type DetectedCommand = z.infer<typeof DetectedCommandSchema>;

export const DirectorySummarySchema = z.object({
  path: z.string(),
  purpose: z.string().optional(),
});
export type DirectorySummary = z.infer<typeof DirectorySummarySchema>;

export const CiSystemProfileSchema = z.object({
  name: z.string(),
  configPath: z.string(),
});
export type CiSystemProfile = z.infer<typeof CiSystemProfileSchema>;

export const ArchitectureMarkerSchema = z.object({
  name: z.string(),
  path: z.string(),
});
export type ArchitectureMarker = z.infer<typeof ArchitectureMarkerSchema>;

export const RepositoryRiskSchema = z.object({
  code: z.string(),
  severity: z.enum(["info", "warning", "blocking"]),
  message: z.string(),
});
export type RepositoryRisk = z.infer<typeof RepositoryRiskSchema>;

export const RepositoryProfileSchema = z.object({
  repositoryUrl: z.string(),
  baseBranch: z.string(),
  commitSha: z.string(),
  cleanWorkingTree: z.boolean(),
  languages: z.array(DetectedLanguageSchema),
  frameworks: z.array(DetectedFrameworkSchema),
  packageManagers: z.array(PackageManagerProfileSchema),
  buildCommands: z.array(DetectedCommandSchema),
  testCommands: z.array(DetectedCommandSchema),
  lintCommands: z.array(DetectedCommandSchema),
  typecheckCommands: z.array(DetectedCommandSchema),
  migrationCommands: z.array(DetectedCommandSchema),
  startCommands: z.array(DetectedCommandSchema),
  directories: z.array(DirectorySummarySchema),
  ciSystems: z.array(CiSystemProfileSchema),
  databaseSystems: z.array(z.string()),
  environmentFiles: z.array(z.string()),
  architectureMarkers: z.array(ArchitectureMarkerSchema),
  risks: z.array(RepositoryRiskSchema),
  unknowns: z.array(z.string()),
});
export type RepositoryProfile = z.infer<typeof RepositoryProfileSchema>;
