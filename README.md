# multi-role-browser

[![npm](https://img.shields.io/npm/v/multi-role-browser)](https://www.npmjs.com/package/multi-role-browser)
[![license](https://img.shields.io/npm/l/multi-role-browser)](LICENSE)

An MCP server that lets an AI agent (Claude Code, or any MCP client) drive **several logged-in browser identities at the same time**: an `admin` and a `user` side by side, for example. Each actor gets its own isolated Playwright browser context (separate cookies, storage and login), all sharing one Chromium.

Use it to have an agent check that admins can do admin things, that regular users can't, and that what one role does shows up correctly for another.

## Install

You need Node.js 20 or newer, and Playwright's Chromium (one-time download, about 120 MB):

```bash
npx playwright install chromium
```

### Claude Code

```bash
claude mcp add --scope user multi-role-browser --env BASE_URL=http://localhost:3000 -- npx -y multi-role-browser
```

Start a new Claude Code session and check it with `/mcp`.

### Other MCP clients

```json
{
  "mcpServers": {
    "multi-role-browser": {
      "command": "npx",
      "args": ["-y", "multi-role-browser"],
      "env": { "BASE_URL": "http://localhost:3000" }
    }
  }
}
```

## Settings

| Environment variable | Default | Meaning |
|---|---|---|
| `BASE_URL` | `http://localhost:3000` | Site that paths like `/login` point to. The agent can change it with `browser_set_base_url`. |
| `HEADLESS` | (unset) | Set to `1` to hide the browser windows. |

## Tools

Every action takes an `actor`: any name you like. A new name starts as a fresh, logged-out browser identity.

| Tool | What it does |
|---|---|
| `browser_open` | Open a path (`/admin`) or full URL as an actor. Returns the HTTP status and a page snapshot. |
| `browser_snapshot` | Show what the actor sees: an accessibility snapshot with element refs like `[ref=e5]`. |
| `browser_click` | Click an element by ref. Waits for page loads and for the requests the click starts (in-app navigation in single-page apps such as React Router or Inertia), then returns the new snapshot. |
| `browser_fill` | Type into an input by ref. |
| `browser_screenshot` | Return a PNG of what the actor sees, for layout and styling the snapshot can't show. Captures the visible part of the page by default, the whole page with `fullPage`, or one element with `ref`. `path` also saves it to a file. |
| `browser_set_base_url` | Change which site paths point to, for all actors. |
| `browser_actors` | List the base URL, the open actors and their tabs. |
| `browser_close` | Close an actor's browser context; using the name again starts fresh. |

Example prompt:

> Log in as admin (admin@example.test / ...) and as user (user@example.test / ...). Check whether user can open /admin, and whether an announcement posted by admin shows up for user.

## Development

```bash
npm install
npx playwright install chromium
npm run site          # dummy multi-role website on http://localhost:3000
npm run demo:agent    # scripted agent driving the MCP server against it
npm run typecheck
npm run build         # compiles src/ to dist/ (what gets published)
```

Node runs the `.ts` sources directly during development; `npm run build` is only needed for publishing.

Releases are published to npm from GitHub Actions; see [RELEASING.md](RELEASING.md).

## License

MIT
