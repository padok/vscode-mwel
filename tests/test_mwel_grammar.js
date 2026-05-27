const assert = require('assert');
const fs = require('fs');
const path = require('path');
const textmate = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

const root = path.resolve(__dirname, '..');
const grammarPath = path.join(root, 'syntaxes', 'mwel.tmLanguage.json');
const wasmPath = require.resolve('vscode-oniguruma/release/onig.wasm');

function tokenScopesForLine(grammar, line) {
  const result = grammar.tokenizeLine(line);
  return result.tokens.map((token) => ({
    text: line.slice(token.startIndex, token.endIndex),
    scopes: token.scopes,
  }));
}

function assertTokenHasScope(tokens, text, scope) {
  const token = tokens.find((candidate) => candidate.text.trim() === text);
  if (token) {
    assert(
      token.scopes.includes(scope),
      `Expected token ${JSON.stringify(text)} to include ${scope}; got ${token.scopes.join(', ')}`
    );
    return;
  }

  const scopedText = tokens
    .filter((candidate) => candidate.scopes.includes(scope))
    .map((candidate) => candidate.text)
    .join('')
    .trim();
  assert(
    scopedText.includes(text),
    `Expected scoped text ${JSON.stringify(text)} with ${scope}; got ${JSON.stringify(tokens)}`
  );
}

async function loadGrammar() {
  const wasm = fs.readFileSync(wasmPath).buffer;
  await oniguruma.loadWASM(wasm);

  const registry = new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
      createOnigString: (source) => new oniguruma.OnigString(source),
    }),
    loadGrammar: async (scopeName) => {
      assert.strictEqual(scopeName, 'source.mwel');
      return textmate.parseRawGrammar(fs.readFileSync(grammarPath, 'utf8'), grammarPath);
    },
  });

  return registry.loadGrammar('source.mwel');
}

async function main() {
  const grammar = await loadGrammar();
  assert(grammar, 'Expected MWEL grammar to load');

  assertTokenHasScope(
    tokenScopesForLine(grammar, 'var x = 2'),
    'var',
    'storage.type.mwel'
  );
  assertTokenHasScope(
    tokenScopesForLine(grammar, "protocol 'Test Protocol' {"),
    'protocol',
    'keyword.control.mwel'
  );
  assertTokenHasScope(
    tokenScopesForLine(grammar, '    if (x > 1) {'),
    'if',
    'keyword.control.conditional.mwel'
  );
  assertTokenHasScope(
    tokenScopesForLine(grammar, "    report ('x = $x')"),
    'report',
    'variable.function.mwel'
  );
  for (const componentName of ['group', 'rectangle', 'fixation_point', 'timer_expired']) {
    assertTokenHasScope(
      tokenScopesForLine(grammar, `    ${componentName} (`),
      componentName,
      'support.type.component.mwel'
    );
  }
  assertTokenHasScope(
    tokenScopesForLine(grammar, '    // comment'),
    '// comment',
    'comment.line.mwel'
  );

  console.log('MWEL grammar tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
