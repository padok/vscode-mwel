const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const componentsPath = path.join(root, 'vendor', 'components.json');
const grammarPath = path.join(root, 'syntaxes', 'mwel.tmLanguage.json');

function main() {
  if (!fs.existsSync(componentsPath)) {
    throw new Error('Missing vendor/components.json. Run: npm run sync:components');
  }

  const components = JSON.parse(fs.readFileSync(componentsPath, 'utf8'));
  const grammar = JSON.parse(fs.readFileSync(grammarPath, 'utf8'));
  const tokens = componentTokens(components);

  ensureGeneratedComponentInclude(grammar);
  grammar.repository.generated_components = {
    patterns: [
      {
        name: 'support.type.component.mwel entity.name.type.component.mwel variable.function.mwel',
        match: `^\\s*(${tokens.map(escapeRegExp).join('|')})\\b(?!\\s*(\\+|-|\\*|/|%)?=)`,
      },
    ],
  };

  fs.writeFileSync(grammarPath, `${JSON.stringify(grammar, null, '\t')}\n`);
  console.log(`Wrote ${tokens.length} generated MWEL component tokens -> ${grammarPath}`);
}

function ensureGeneratedComponentInclude(grammar) {
  const include = { include: '#generated_components' };
  if (grammar.patterns.some((pattern) => pattern.include === include.include)) {
    return;
  }

  const genericIndex = grammar.patterns.findIndex((pattern) => pattern.include === '#generic_component');
  if (genericIndex >= 0) {
    grammar.patterns.splice(genericIndex, 0, include);
  } else {
    grammar.patterns.push(include);
  }
}

function componentTokens(components) {
  const tokens = new Set();
  const shortNames = new Map();

  for (const info of Object.values(components)) {
    if (!info.signature) {
      continue;
    }

    addToken(tokens, info.signature);
    for (const alias of [...asArray(info.alias), ...asArray(info.mwel_alias)]) {
      addToken(tokens, alias);
    }

    const parts = info.signature.split('/');
    if (parts.length > 1) {
      const entries = shortNames.get(parts[1]) || [];
      entries.push(info.signature);
      shortNames.set(parts[1], entries);
    }
  }

  for (const [shortName, signatures] of shortNames) {
    if (signatures.length === 1) {
      addToken(tokens, shortName);
    }
  }

  return [...tokens].sort((left, right) => right.length - left.length || left.localeCompare(right));
}

function addToken(tokens, token) {
  if (/^[A-Za-z][A-Za-z0-9_]*(\/[A-Za-z][A-Za-z0-9_]*)?$/.test(token)) {
    tokens.add(token);
  }
}

function asArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main();
