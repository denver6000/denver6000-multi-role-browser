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

On npmjs.com, open the package > **Settings** > **Trusted Publisher** > **GitHub Actions**, and enter `denver6000`, `denver6000-multi-role-browser` (the repository, not the package name) and the workflow file name `publish.yml`.

## Every release after that

```bash
npm version patch         # or minor / major: bumps package.json and creates the tag
git push --follow-tags    # the tag starts .github/workflows/publish.yml
```

The workflow checks the tag matches `package.json`, type-checks, builds and publishes with provenance. A version that is already on npm (such as the one published by hand) is skipped instead of failing.
