# ESLint glob compatibility

The current React, import, and accessibility ESLint plugins require minimatch's
old callable CommonJS export. The globparts amplification advisory
GHSA-g3hv-75wg-m249 affects minimatch versions below 11.0.1. A direct upgrade
breaks that old calling convention.

This private adapter preserves the callable export, named exports, and callable
`defaults()` result while delegating matching to upstream minimatch 11.0.3.
No matching algorithm or security fix is implemented here. The root override
applies only to tooling; the patched engine is installed under the distinct
`minimatch-modern` dependency name to avoid recursively overriding itself.

Remove this adapter when the ESLint plugins support the current minimatch API.
