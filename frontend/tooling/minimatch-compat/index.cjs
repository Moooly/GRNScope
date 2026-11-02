/* eslint-disable @typescript-eslint/no-require-imports -- Preserve the CommonJS API required by legacy ESLint plugins. */
// Older ESLint plugins call the module directly; current consumers use its
// named exports. Both APIs delegate to the same patched upstream engine.
const modern = require('minimatch-modern');
function legacyApi(engine) {
  function minimatch(path, pattern, options) {
    return (typeof engine === "function" ? engine : engine.minimatch)(path, pattern, options);
  }
  Object.assign(minimatch, engine);
  minimatch.defaults = (options) => legacyApi(engine.defaults(options));
  return minimatch;
}
module.exports = legacyApi(modern);
