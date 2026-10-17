# Planner Service

Standalone AI planning service that turns a rough project brief into a validated, auditable build manifest for downstream implementation agents.

## What Is Implemented

- pnpm workspace monorepo.
- Fastify API with `/v1/plans` lifecycle routes and OpenAPI UI at `/docs`.
- PostgreSQL persistence via Prisma.
- Redis/BullMQ asynchronous job queue.
- Worker process that runs isolated planning stages sequentially.
- Provider-independent LLM interface with OpenAI-compatible, Ollama, and llama.cpp server providers.
- Zod-validated stage output with JSON extraction and repair attempts, including per-category minimum finding counts for the edge-case hunter stage.
- Manifest compilation to JSON, YAML, and Markdown artifacts.
- Quality gate and targeted revision routing.
- Prometheus metrics at `GET /metrics` (job counts, stage duration/failures, LLM requests/tokens, revision cycles, quality score).

## Local Setup

1. Install dependencies:

   ```sh
   pnpm install
   ```

2. Copy env values:

   ```sh
   cp .env.example .env
   ```

3. Start infrastructure:

   ```sh
   docker compose up -d
   ```

4. Generate Prisma client and apply the schema:

   ```sh
   pnpm db:generate
   pnpm db:migrate
   ```

5. Start the API and worker in separate terminals:

   ```sh
   pnpm dev:api
   pnpm dev:worker
   ```

6. Submit a sample plan:

   ```sh
   curl -X POST http://localhost:3000/v1/plans \
     -H "content-type: application/json" \
     --data @examples/sample-plan-request.json
   ```

## Testing

- `pnpm test` runs fast unit tests only.
- `pnpm test:integration` runs the orchestrator against a real, ephemeral Postgres container via Testcontainers (requires Docker). It covers: a full successful run, unrecoverable malformed model output, a persistent provider timeout, worker-restart resume without redoing completed stages, an immediate quality-gate failure, a successful targeted revision, revision-limit exhaustion, and mid-run cancellation.
- `pnpm test:all` runs both.

## Examples

`examples/sample-manifest.{json,yaml,md}` is a real build manifest compiled from schema-valid fixture stage outputs (the same fixtures the integration tests use), not hand-authored. Regenerate it after a schema change with:

```sh
pnpm --filter @planner/planner-core generate:example
```

## API

- `POST /v1/plans` creates and queues a planning job.
- `GET /v1/plans/:planId` returns status and progress.
- `GET /v1/plans/:planId/manifest` returns the latest manifest. Use `Accept: application/json`, `Accept: application/yaml`, or `Accept: text/markdown`.
- `GET /v1/plans/:planId/stages/:stageName` returns the latest stage execution output.
- `POST /v1/plans/:planId/cancel` cancels a queued or tracked plan.
- `POST /v1/plans/:planId/retry` requeues a failed plan.
- `POST /v1/plans/:planId/instructions` records human direction and requeues a revision branch.
- `GET /metrics` returns Prometheus-format metrics for the API process.

## Configuration Notes

- `STORE_RAW_LLM_OUTPUT` (default `true`): set to `false` to omit raw model responses from `StageExecution.rawOutput` in production.
- `DEFAULT_LLM_PROVIDER` accepts `openai-compatible`, `ollama`, or `llama.cpp` — all speak the OpenAI chat-completions wire format, so switching providers is a configuration change, not a code change.
