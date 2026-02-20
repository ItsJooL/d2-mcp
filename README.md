# d2-mcp-server

An MCP (Model Context Protocol) server for the [D2 diagram language](https://d2lang.com). Lets LLMs render, validate, and format D2 diagrams without requiring the `d2` binary — rendering is powered by the `@terrastruct/d2` WASM package.

## Tools

| Tool | Description | Requires `d2` binary? |
|------|-------------|----------------------|
| `d2_render` | Compile and render D2 source to SVG or ASCII art | No |
| `d2_validate` | Check D2 syntax and return errors | No |
| `d2_format` | Canonically format D2 source code | Yes |
| `d2_list_themes` | List all available themes with IDs | No |
| `d2_list_layouts` | List available layout engines | No |

## Install the D2 Skill

The repo ships a `d2` agent skill that teaches LLMs how to write effective D2 diagrams (syntax, styling, patterns, when to use which layout engine, and how to save output).

Install it via [skills.sh](https://github.com/vercel-labs/skills):

```bash
npx skills add itsjool/d2-mcp
```

This drops `skills/d2/SKILL.md` into your agent's skills directory so it's automatically available in any session.

---

## Requirements

- Node.js 18+
- `d2` binary only required for `d2_format` — install from [d2lang.com](https://d2lang.com) or set `D2_PATH` env var

## Install

```bash
npm install
npm run build
```

## Usage with Claude Code

**Via npx (no install required):**

```json
{
  "mcpServers": {
    "d2": {
      "command": "npx",
      "args": ["-y", "github:itsjool/d2-mcp"]
    }
  }
}
```

**Via local build:**

```json
{
  "mcpServers": {
    "d2": {
      "command": "node",
      "args": ["/path/to/d2-mcp/dist/index.js"]
    }
  }
}
```

Then start Claude Code with:

```bash
claude --mcp-config /path/to/mcp.json
```

## Development

```bash
npm run dev     # watch mode with tsx
npm run build   # compile TypeScript to dist/
npm start       # run compiled server
```

## Notes
- ELK layout is significantly slower than dagre in WASM; prefer dagre unless you specifically need ancestor-to-descendant connections or container sizing

## License

MIT
