# Changesets

Create a changeset for a user-facing package change:

```bash
pnpm changeset
```

Internal workspace packages remain private. The initial public release is a bundled root package, versioned in root `package.json` and the CLI's version flag; Changesets does not version that root artifact automatically. Keep those versions aligned and run `pnpm build` followed by `pnpm smoke:release`. Do not publish private workspace packages or assume `version-packages` prepares the public artifact. Registry publication remains a separate maintainer-approved step after the audit gates pass.
