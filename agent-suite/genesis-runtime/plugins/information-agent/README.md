# Information Agent

Information Agent lets Nova monitor web sources for user-defined interests.

Core flow:

- Save an interest that describes what Nova should care about.
- Add sources for that interest: blogs, news, social posts, finance pages, shopping/product pages, or general web URLs.
- Nova scans due sources on startup and every five minutes.
- When a source changes, the plugin records and broadcasts a synthesized update with evidence.

The plugin exposes:

- UI tab: `Info Agent`
- Routes under `/api/information-agent/*`
- Tools:
  - `info_agent_save_interest`
  - `info_agent_add_source`
  - `info_agent_run_scan`
  - `info_agent_list_updates`
  - `info_agent_ack_update`

Dynamic pages can opt into browser-based capture with `useBrowser: true` when the Browser plugin is available. Static sources use Node `fetch`.
