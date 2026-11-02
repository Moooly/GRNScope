# Frontend tooling

The root dependency uses the committed 1 KB tarball, so npm can install this
replacement portably under the dependency name `minimatch`. To change the
adapter, bump its package version and the root tarball path, then run
`npm run pack:tooling` and `npm install`. Compatibility tests exercise both
CommonJS and ESM imports, callable matching, named classes, and defaults.
