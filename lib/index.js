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
const noErrorToNull = require('./rules/no-error-to-null')
const noContextStripping = require('./rules/no-context-stripping')
const noGenericApiError = require('./rules/no-generic-api-error')
const requireResOkCheck = require('./rules/require-res-ok-check')
const noErrorMasking = require('./rules/no-error-masking')

const plugin = {
  rules: {
    'no-swallowing-catch': noSwallowingCatch,
    'no-error-to-null': noErrorToNull,
    'no-context-stripping': noContextStripping,
    'no-generic-api-error': noGenericApiError,
    'require-res-ok-check': requireResOkCheck,
    'no-error-masking': noErrorMasking,
  },
}

plugin.configs = {
  // Legacy .eslintrc (JSON/CJS/JS). Consumers:
  //   { "extends": ["plugin:@zantha-ltd/fail-fast/recommended"] }
  recommended: {
    plugins: ['@zantha-ltd/fail-fast'],
    rules: {
      '@zantha-ltd/fail-fast/no-swallowing-catch': 'error',
      '@zantha-ltd/fail-fast/no-error-to-null': 'error',
      '@zantha-ltd/fail-fast/no-context-stripping': 'error',
      '@zantha-ltd/fail-fast/no-generic-api-error': 'error',
      '@zantha-ltd/fail-fast/require-res-ok-check': 'error',
      '@zantha-ltd/fail-fast/no-error-masking': 'error',
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
      '@zantha-ltd/fail-fast/no-error-to-null': 'error',
      '@zantha-ltd/fail-fast/no-context-stripping': 'error',
      '@zantha-ltd/fail-fast/no-generic-api-error': 'error',
      '@zantha-ltd/fail-fast/require-res-ok-check': 'error',
      '@zantha-ltd/fail-fast/no-error-masking': 'error',
    },
  },
}

// Patch the self-reference: flat config requires the plugin value to be
// the plugin object itself, not a string identifier.
plugin.configs['flat/recommended'].plugins['@zantha-ltd/fail-fast'] = plugin

module.exports = plugin
