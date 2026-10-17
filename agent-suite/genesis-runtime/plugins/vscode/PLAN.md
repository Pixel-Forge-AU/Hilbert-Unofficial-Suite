# VS Code Context Bridge Plan

## Goal

Let Nova see the current VS Code workspace context and work on real project files through a narrow, user-controlled bridge.

This is intentionally not a direct host filesystem mount. The VS Code extension stays the workspace authority, and Nova asks the bridge for scoped context or creates edit requests for VS Code to apply.

## Architecture

```text
VS Code extension
  -> local HTTP/WebSocket bridge
  -> Nova vscode plugin
  -> Nova worker tools and existing plugins
```

## MVP Scope

- Register a `vscode` Nova plugin.
- Accept snapshots from a VS Code extension:
  - workspace folders
  - active editor
  - open editors
  - file tree entries
  - diagnostics
  - git status and diff summaries
  - optional file contents for open or requested files
- Expose worker tools:
  - `vscode_get_context`
  - `vscode_list_files`
  - `vscode_read_file`
  - `vscode_get_diagnostics`
  - `vscode_git_status`
  - `vscode_request_edit`
- Inject worker prompt guidance when a VS Code session is connected.
- Keep write operations approval-oriented by queuing edit requests for the VS Code side to apply.

## Phase 1: Plugin Starter

- Add plugin routes:
  - `GET /api/vscode-bridge/status`
  - `GET /api/vscode-bridge/pairing`
  - `POST /api/vscode-bridge/snapshot`
  - `GET /api/vscode-bridge/requests`
  - `POST /api/vscode-bridge/requests/:requestId/complete`
- Generate and persist a pairing token in plugin data.
- Store the latest in-memory session snapshots.
- Add smoke coverage for snapshot normalization and edit request flow.

## Phase 2: VS Code Extension

- Create a VS Code extension that can pair with Nova using the pairing token.
- Push context on active editor changes, diagnostics changes, git changes, and file tree refresh.
- Poll pending edit requests or hold a WebSocket connection.
- Show edit diffs in VS Code and apply only after user approval.

## Phase 3: Task Integration

- Add richer git tools:
  - `vscode_git_diff`
  - `vscode_git_branch`
  - `vscode_git_commit_request`
- Add task/test hooks:
  - `vscode_list_tasks`
  - `vscode_run_task_request`
  - `vscode_get_terminal_excerpt`
- Teach README and project plugins to prefer VS Code context when present.

## Security Notes

- Do not mount arbitrary host paths into the Nova sandbox.
- Treat VS Code as the trusted local workspace actor.
- Keep mutation as a request until the VS Code extension displays and applies it.
- Require the pairing token for VS Code-originated writes.
- Keep git mutation and terminal execution as explicit request/approval flows.

