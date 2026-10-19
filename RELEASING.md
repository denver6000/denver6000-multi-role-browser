# Releasing

The version lives only in `package.json`; the server reads it from there at startup.

## First publish

Trusted publishing cannot do a package's first release, because a trusted publisher is configured on a package that already exists. So the first release goes out from a workstation, and every release after that is automated. No access token is needed; npm authenticates in the browser:

```bash
npm logout          # clears any stored _authToken from ~/.npmrc
npm login           # opens a browser
npm whoami          # must print denver6000
npm publish         # prepublishOnly type-checks and builds first
```

If your second factor is an authenticator app rather than a passkey, `npm publish --otp=123456` also works.

## Then switch CI on (once)

On npmjs.com, open the package > **Settings** > **Trusted Publisher** > **GitHub Actions**, and enter `denver6000`, `denver6000-multi-role-browser` (the repository, not the package name) and the workflow file name `publish.yml`. Leave the environment name empty, and leave **Allow npm publish** unchecked: the workflow only stages releases, and you approve each one.

## Every release after that

```bash
npm version patch         # or minor / major: bumps package.json and creates the tag
git push --follow-tags    # the tag starts .github/workflows/publish.yml
```

The workflow checks the tag matches `package.json`, type-checks, builds and **stages** the release with provenance. A version that is already on npm (such as the one published by hand) is skipped instead of failing.

Nothing is live until you approve the staged version with 2FA, either on the package's page on npmjs.com or from a logged-in terminal:

```bash
npm stage list multi-role-browser    # shows the stage id of the new version
npm stage approve <stage-id>         # publishes it; asks for 2FA
```

To throw a staged version away instead, use `npm stage reject <stage-id>`.
