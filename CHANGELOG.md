# Changelog

All notable changes to Robots in a House.

## [0.4.0] - 2026-04-27

### Added
- **Suite HQ office** — new 7th office for RunSuite product development (Suite agent, Opus, Product Director)
- **Unbrowse MCP integration** — all agents now have web interaction tools via stdio MCP server (`npx unbrowse mcp`)
- AGENTS.md Unbrowse documentation — usage guide for resolve, browse, snap, click, fill, execute workflows
- RunSuite product spec captured in Einstein's ideas files (positioning, architecture, dashboard, pricing, competitive research)
- Groupchat "new chat" — saves conversation to Switch's memory, resets sessions for fresh rounds
- Groupchat force-send — interrupt stuck agents and deliver queued messages immediately
- Groupchat auto-skip — agents with 2+ consecutive errors are automatically dropped from rounds
- Dropped member tracking (dropped, dropped_at, drop_reason columns on groupchat_members)
- Groupchat memory files at `agent-workspaces/operations/switch/groupchat-memory/`
- Drag-to-reorder office navigation pills (persisted to localStorage)

### Changed
- Agent runner mcpServers type widened from SDK-only to `McpServerConfig` (supports stdio + SSE + HTTP servers)
- Cleaned up 35 orphaned agent workspaces to `agent-workspaces/_archive/`
- Updated MEMORY.md, CHANGELOG.md, and AGENTS.md with current roster, architecture, and tooling

### Fixed
- Grid view dock panel text overflow (missing `min-w-0` in flex chain)
- Groupchat new-chat no longer resends old messages (clears user_messages on reset)
- Agent runner guards against orphaned sessions overwriting force-interrupted status

## [0.3.1] - 2026-04-19

### Added
- Prompt queue system with auto-dequeue on agent completion
- Tool approval flow (approve/deny from UI, agents wait for response)
- Groupchat system replacing war rooms (agent-initiated multi-agent meetings)
- Operations Center office with 6 agents (Captain, Smee, Monet, Squash, Scape, Pipe)
- Ops Bunker custom room (multi-layer pixel art)
- Agent todos panel (per-agent task lists)
- Native desktop app via Electron (separate repo: robots-in-a-house-desktop)
- Desktop: splash screen, system tray, native notifications, auto-updater
- Desktop: persistent user data in ~/Library/Application Support/
- Desktop: settings panel with version info and update check

### Changed
- Switched from isometric to top-down rendering (LimeZu Modern Interiors)
- 12 pixel-art agent sprites with idle animations
- Premade rooms per office (Japanese lounge, Museum Room 3, Ops Bunker)
- Drag-to-reposition agents with snap-to-grid
- Floating name tags, status indicators, grid overlay toggle
- Don't Call palette filter (warm hue/amber tint)
- Command palette lists all 3 offices

### Fixed
- Production build compatibility (Zod 4 + Next.js 16)
- Agent click targeting
- Zombie run cleanup on runner restart
- LimeZu sprite direction mapping (S/E swap)

## [0.1.0] - 2026-04-12

### Added
- Initial Next.js app with PixiJS canvas
- Agent runner HTTP server (port 3100)
- SQLite database for agent state
- Paradise and Don't Call office configs
- Basic agent visualization
