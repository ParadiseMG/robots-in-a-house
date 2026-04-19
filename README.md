# robots-in-a-house

Top-down pixel-art office where Connor works alongside AI agents (real Claude Agent SDK sessions) rendered as sprites. Two offices: **Paradise** (music events) and **Don't Call** (SMS service for tradespeople).

## Install with Claude Code

```bash
claude -p "clone ParadiseMG/robots-in-a-house, install deps, and run the dev server"
```

Or step by step:

```bash
git clone https://github.com/ParadiseMG/robots-in-a-house.git
cd robots-in-a-house
claude
```

Then tell Claude: `install and run it`. It'll handle `npm install`, start the dev server, and walk you through auth setup.

## Run it manually

```bash
npm install
npm run dev
```

Next on `:3000`, agent runner on `:3100`. DB auto-migrates on first boot.

SDK auth comes from the `claude` CLI login or `ANTHROPIC_API_KEY` env.

## Contributing — read this first

**→ `docs/BUILDING.md`** is the complete builder brief: architecture, repo map, DB schema, message flow, feature pattern, conventions, and known gotchas. A new agent (human or AI) should be able to pick up work from that doc alone.

Directors (Maestro for Paradise, Foreman for Don't Call) own both org design and build work — ask them when you want a feature or a new agent.

## Credits

Character and interior sprites by LimeZu — https://limezu.itch.io/moderninteriors
