/**
 * @zantha/eslint-plugin-fail-fast
 *
 * Rules that enforce the fail-fast error-handling principle — errors must be
 * visible, never swallowed, masked, or silently converted to null/empty/false.
 *
 * See the fail-fast-coding skill on zantha-roles for the full anti-pattern
 * catalogue this plugin is growing towards.
 */

const noSwallowingCatch = require('./rules/no-swallowing-catch')

const plugin = {
  rules: {
    'no-swallowing-catch': noSwallowingCatch,
  },
}

plugin.configs = {
  // Legacy .eslintrc (JSON/CJS/JS). Consumers:
  //   { "extends": ["plugin:@zantha-ltd/fail-fast/recommended"] }
  recommended: {
    plugins: ['@zantha-ltd/fail-fast'],
    rules: {
      '@zantha-ltd/fail-fast/no-swallowing-catch': 'error',
    },
  },

  // Flat config (eslint.config.js/mjs). Consumers:
  //   import failFast from '@zantha-ltd/eslint-plugin-fail-fast'
  //   export default [ failFast.configs['flat/recommended'], ... ]
  //
  // The plugin-as-object reference is patched in below, since the plugin
  // variable is only fully formed once we're done building configs.
  'flat/recommended': {
    plugins: { '@zantha-ltd/fail-fast': null },
    rules: {
      '@zantha-ltd/fail-fast/no-swallowing-catch': 'error',
    },
  },
}

// Patch the self-reference: flat config requires the plugin value to be
// the plugin object itself, not a string identifier.
plugin.configs['flat/recommended'].plugins['@zantha-ltd/fail-fast'] = plugin

module.exports = plugin
