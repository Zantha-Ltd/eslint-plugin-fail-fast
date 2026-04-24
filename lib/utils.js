/**
 * Shared AST helpers for fail-fast rules.
 *
 * Kept deliberately small and dependency-free — each helper is a leaf node in
 * the plugin's internal call graph so individual rules stay easy to read and
 * tree-shake.
 */

const CONSOLE_METHODS = new Set(['log', 'warn', 'error', 'info', 'debug', 'trace'])

function isConsoleCall(expr) {
  if (!expr || expr.type !== 'CallExpression') return false
  const callee = expr.callee
  return callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'console' &&
    callee.property.type === 'Identifier' &&
    CONSOLE_METHODS.has(callee.property.name)
}

function referencesName(node, name) {
  if (!node || !name) return false
  if (node.type === 'Identifier') return node.name === name
  if (node.type === 'MemberExpression') {
    return referencesName(node.object, name) || (node.computed && referencesName(node.property, name))
  }
  if (node.type === 'CallExpression') {
    return referencesName(node.callee, name) || node.arguments.some(a => referencesName(a, name))
  }
  if (node.type === 'NewExpression') {
    return referencesName(node.callee, name) || node.arguments.some(a => referencesName(a, name))
  }
  if (node.type === 'TemplateLiteral') {
    return node.expressions.some(e => referencesName(e, name))
  }
  if (node.type === 'BinaryExpression' || node.type === 'LogicalExpression') {
    return referencesName(node.left, name) || referencesName(node.right, name)
  }
  if (node.type === 'ConditionalExpression') {
    return referencesName(node.test, name) || referencesName(node.consequent, name) || referencesName(node.alternate, name)
  }
  if (node.type === 'ObjectExpression') {
    return node.properties.some(p => p.type === 'Property' && referencesName(p.value, name))
  }
  if (node.type === 'ArrayExpression') {
    return node.elements.some(e => e && referencesName(e, name))
  }
  if (node.type === 'TSAsExpression' || node.type === 'TSTypeAssertion' || node.type === 'TSNonNullExpression') {
    return referencesName(node.expression, name)
  }
  if (node.type === 'AwaitExpression' || node.type === 'UnaryExpression' || node.type === 'SpreadElement') {
    return referencesName(node.argument, name)
  }
  if (node.type === 'AssignmentExpression') {
    return referencesName(node.left, name) || referencesName(node.right, name)
  }
  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
    if (node.body.type === 'BlockStatement') {
      return node.body.body.some(s => statementReferencesName(s, name))
    }
    return referencesName(node.body, name)
  }
  return false
}

function statementReferencesName(stmt, name) {
  if (!stmt) return false
  if (stmt.type === 'ExpressionStatement') return referencesName(stmt.expression, name)
  if (stmt.type === 'ReturnStatement') return stmt.argument ? referencesName(stmt.argument, name) : false
  if (stmt.type === 'ThrowStatement') return referencesName(stmt.argument, name)
  if (stmt.type === 'VariableDeclaration') return stmt.declarations.some(d => d.init && referencesName(d.init, name))
  if (stmt.type === 'IfStatement') {
    return referencesName(stmt.test, name) ||
      statementReferencesName(stmt.consequent, name) ||
      (stmt.alternate && statementReferencesName(stmt.alternate, name))
  }
  if (stmt.type === 'BlockStatement') return stmt.body.some(s => statementReferencesName(s, name))
  return false
}

/**
 * Does a statement surface `errName` in a way that counts as "the user will
 * see this error"? `console.*(err)` does NOT count — it's log-only. This
 * walks the whole subtree so nested references (e.g. inside an `if` branch)
 * are classified correctly, while refusing to descend into console calls or
 * nested function bodies (a different scope).
 */
function statementSurfacesErr(stmt, errName) {
  if (!stmt || !errName) return false
  return hasNonConsoleErrRef(stmt, errName)
}

function hasNonConsoleErrRef(node, errName) {
  if (!node || typeof node !== 'object') return false
  if (node.type === 'CallExpression' && isConsoleCall(node)) return false
  // Descend into nested arrows/functions — they capture the outer err, and
  // passing err into e.g. `setState(prev => ({ …, error: err.message }))`
  // counts as surfacing even though the reference lives in an inner scope.
  if (node.type === 'Identifier' && node.name === errName) return true
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue
    const value = node[key]
    if (!value || typeof value !== 'object') continue
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v && typeof v === 'object' && hasNonConsoleErrRef(v, errName)) return true
      }
    } else if (typeof value.type === 'string') {
      if (hasNonConsoleErrRef(value, errName)) return true
    }
  }
  return false
}

function containsThrow(node) {
  if (!node || typeof node !== 'object') return false
  if (node.type === 'ThrowStatement') return true
  // Don't descend into nested functions — their throws belong to a different scope
  if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
    return false
  }
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue
    const value = node[key]
    if (!value || typeof value !== 'object') continue
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v && typeof v === 'object' && containsThrow(v)) return true
      }
    } else if (typeof value.type === 'string') {
      if (containsThrow(value)) return true
    }
  }
  return false
}

/**
 * Is `node` a "bare" literal value — the degenerate defaults that
 * error-to-null handlers silently return?
 *
 *   null, undefined (identifier or literal), false, 0, '', [], {}
 *
 * `return;` (no argument) is treated as bare (implicit undefined).
 */
function isBareLiteral(node) {
  if (!node) return true
  if (node.type === 'Literal') {
    return node.value === null || node.value === false || node.value === 0 || node.value === ''
  }
  if (node.type === 'Identifier' && node.name === 'undefined') return true
  if (node.type === 'ArrayExpression' && node.elements.length === 0) return true
  if (node.type === 'ObjectExpression' && node.properties.length === 0) return true
  return false
}

function describeBareLiteral(node) {
  if (!node) return 'undefined'
  if (node.type === 'Literal') {
    if (node.value === null) return 'null'
    if (node.value === '') return "''"
    return String(node.value)
  }
  if (node.type === 'Identifier' && node.name === 'undefined') return 'undefined'
  if (node.type === 'ArrayExpression') return '[]'
  if (node.type === 'ObjectExpression') return '{}'
  return 'a default value'
}

/**
 * Is `node` the callee of a `new X(...)` where X is `Error` or any identifier
 * ending in `Error` (e.g. `TypeError`, `AuthError`, `ValidationError`)? This
 * matches both the built-in subclasses and user-defined error classes, which
 * share the same context-chaining contract.
 */
function isErrorConstructor(node) {
  if (!node || node.type !== 'Identifier') return false
  return node.name === 'Error' || /Error$/.test(node.name)
}

/**
 * Collect every `ThrowStatement` node inside `stmt`, descending through
 * blocks / if / try / etc. but stopping at nested function bodies (a throw
 * inside an uncalled arrow belongs to a different scope).
 */
function collectThrows(node, out) {
  if (!node || typeof node !== 'object') return
  if (node.type === 'ThrowStatement') {
    out.push(node)
    return
  }
  if (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  ) {
    return
  }
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue
    const value = node[key]
    if (!value || typeof value !== 'object') continue
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v && typeof v === 'object') collectThrows(v, out)
      }
    } else if (typeof value.type === 'string') {
      collectThrows(value, out)
    }
  }
}

module.exports = {
  CONSOLE_METHODS,
  isConsoleCall,
  referencesName,
  statementReferencesName,
  statementSurfacesErr,
  containsThrow,
  isBareLiteral,
  describeBareLiteral,
  isErrorConstructor,
  collectThrows,
}
