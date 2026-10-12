# multi-role-browser

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
| `browser_click` | Click an element by ref. Returns the new snapshot. |
| `browser_fill` | Type into an input by ref. |
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

## Release

The version lives only in `package.json`; the server reads it from there at startup.

### First publish

Trusted publishing cannot do a package's first release, because a trusted publisher is configured on a package that already exists. So the first release goes out from a workstation, and every release after that is automated. No access token is needed; npm authenticates in the browser:

```bash
npm logout          # clears any stored _authToken from ~/.npmrc
npm login           # opens a browser
npm whoami          # must print denver6000
npm publish         # prepublishOnly type-checks and builds first
```

If your second factor is an authenticator app rather than a passkey, `npm publish --otp=123456` also works.

### Then switch CI on (once)

On npmjs.com, open the package > **Settings** > **Trusted Publisher** > **GitHub Actions**, and enter `denver6000`, `denver6000-multi-role-browser` (the repository, not the package name) and the workflow file name `publish.yml`.

### Every release after that

```bash
npm version patch         # or minor / major: bumps package.json and creates the tag
git push --follow-tags    # the tag starts .github/workflows/publish.yml
```

The workflow checks the tag matches `package.json`, type-checks, builds and publishes with provenance. A version that is already on npm (such as the one published by hand) is skipped instead of failing.

## License

MIT
