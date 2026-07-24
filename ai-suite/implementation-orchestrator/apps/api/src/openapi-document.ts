export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Implementation Orchestrator API",
    version: "0.1.0",
    description:
      "Accepts an approved build manifest, compiles it into a task graph, and reports on workflow/task state as the pipeline runs.",
  },
  paths: {
    "/health": {
      get: {
        summary: "Liveness check",
        responses: { "200": { description: "OK" } },
      },
    },
    "/health/ready": {
      get: {
        summary: "Readiness check (verifies database connectivity)",
        responses: { "200": { description: "Ready" }, "503": { description: "Not ready" } },
      },
    },
    "/metrics": {
      get: {
        summary: "Prometheus metrics exposition",
        responses: { "200": { description: "OK", content: { "text/plain": {} } } },
      },
    },
    "/v1/workflows": {
      post: {
        summary: "Create a workflow from an approved build manifest",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateWorkflowRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "Workflow created",
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreateWorkflowResponse" } } },
          },
          "400": { description: "Invalid request body" },
        },
      },
      get: {
        summary: "List workflows",
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/WorkflowSummary" } },
              },
            },
          },
        },
      },
    },
    "/v1/workflows/{workflowId}": {
      get: {
        summary: "Get a workflow's current state",
        parameters: [{ name: "workflowId", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "OK",
            content: { "application/json": { schema: { $ref: "#/components/schemas/WorkflowSummary" } } },
          },
          "404": { description: "Workflow not found" },
        },
      },
    },
    "/v1/workflows/{workflowId}/tasks": {
      get: {
        summary: "List a workflow's tasks",
        parameters: [
          { name: "workflowId", in: "path", required: true, schema: { type: "string" } },
          { name: "status", in: "query", required: false, schema: { type: "string" } },
          { name: "phaseId", in: "query", required: false, schema: { type: "string" } },
          { name: "priority", in: "query", required: false, schema: { type: "string" } },
          { name: "builderProfile", in: "query", required: false, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/TaskSummary" } } },
            },
          },
          "404": { description: "Workflow not found" },
        },
      },
    },
    "/v1/workflows/{workflowId}/tasks/{taskId}": {
      get: {
        summary: "Get a single task",
        parameters: [
          { name: "workflowId", in: "path", required: true, schema: { type: "string" } },
          { name: "taskId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "OK",
            content: { "application/json": { schema: { $ref: "#/components/schemas/TaskSummary" } } },
          },
          "404": { description: "Task not found" },
        },
      },
    },
    "/v1/workflows/{workflowId}/cancel": {
      post: {
        summary: "Cancel a workflow (stops new leases, marks non-terminal tasks cancelled, retains all evidence)",
        parameters: [{ name: "workflowId", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Workflow cancelled",
            content: { "application/json": { schema: { $ref: "#/components/schemas/WorkflowSummary" } } },
          },
          "404": { description: "Workflow not found" },
        },
      },
    },
    "/v1/workflows/{workflowId}/artifacts": {
      get: {
        summary: "List a workflow's stored artifacts",
        parameters: [{ name: "workflowId", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "OK" },
          "404": { description: "Workflow not found" },
        },
      },
    },
  },
  components: {
    schemas: {
      CreateWorkflowRequest: {
        type: "object",
        required: ["name", "manifest", "repository", "policyProfile", "builderProfile"],
        properties: {
          name: { type: "string" },
          manifest: { type: "object", description: "The approved build manifest (spec section 10)." },
          repository: {
            type: "object",
            required: ["url", "baseBranch"],
            properties: {
              url: { type: "string" },
              baseBranch: { type: "string" },
              credentialReference: { type: "string" },
            },
          },
          policyProfile: { type: "string", example: "default-safe" },
          builderProfile: { type: "string", example: "mock" },
        },
      },
      CreateWorkflowResponse: {
        type: "object",
        properties: {
          workflowId: { type: "string" },
          status: { type: "string" },
        },
      },
      WorkflowSummary: {
        type: "object",
        properties: {
          workflowId: { type: "string" },
          name: { type: "string" },
          status: {
            type: "string",
            enum: [
              "created",
              "validating_manifest",
              "inspecting_repository",
              "compiling_tasks",
              "validating_task_graph",
              "preparing_workspace",
              "running",
              "verifying",
              "remediating",
              "release_gate",
              "completed",
              "failed",
              "cancelled",
            ],
          },
          manifestHash: { type: "string" },
          baseCommitSha: { type: "string", nullable: true },
          taskTotals: { type: "object", additionalProperties: { type: "integer" } },
          activeLeases: { type: "integer" },
          retryCount: { type: "integer" },
          latestErrors: { type: "array", items: { type: "string" } },
          createdAt: { type: "string", format: "date-time" },
          startedAt: { type: "string", format: "date-time", nullable: true },
          completedAt: { type: "string", format: "date-time", nullable: true },
          failedAt: { type: "string", format: "date-time", nullable: true },
          cancelledAt: { type: "string", format: "date-time", nullable: true },
          completionSummary: { type: "object", nullable: true },
          failureDetails: { type: "object", nullable: true },
        },
      },
      TaskSummary: {
        type: "object",
        properties: {
          id: { type: "string" },
          workflowId: { type: "string" },
          status: { type: "string" },
          phaseId: { type: "string" },
          title: { type: "string" },
          category: { type: "string" },
          priority: { type: "string" },
          builderProfile: { type: "string" },
          dependencies: { type: "array", items: { type: "string" } },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          readyAt: { type: "string", format: "date-time", nullable: true },
          acceptedAt: { type: "string", format: "date-time", nullable: true },
          failedAt: { type: "string", format: "date-time", nullable: true },
        },
      },
    },
  },
} as const;
