const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'vendor', 'components.json');
const sourceRoots = [
  path.join(root, 'mworks', 'core', 'MWComponents.yaml'),
  path.join(root, 'mworks', 'plugins', 'core'),
  path.join(root, 'mworks', 'tools', 'python', 'PythonPlugin', 'MWComponents.yaml'),
];

function main() {
  const yamlFiles = componentFiles();
  if (yamlFiles.length === 0) {
    throw new Error('No MWorks component metadata found. Run: git submodule update --init mworks');
  }

  const registry = new ComponentRegistry();
  for (const filename of yamlFiles) {
    const docs = YAML.parseAllDocuments(fs.readFileSync(filename, 'utf8'));
    for (const doc of docs) {
      if (doc.errors.length > 0) {
        throw new Error(`${filename}: ${doc.errors[0].message}`);
      }
      const info = doc.toJSON();
      if (info) {
        registry.register(info);
      }
    }
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(registry.components, null, 2)}\n`);
  console.log(`Wrote ${Object.keys(registry.components).length} components -> ${destination}`);
}

function componentFiles() {
  const files = [];
  for (const source of sourceRoots) {
    if (!fs.existsSync(source)) {
      continue;
    }
    const stats = fs.statSync(source);
    if (stats.isFile()) {
      files.push(source);
    } else {
      files.push(...findFiles(source, 'MWComponents.yaml').sort());
    }
  }
  return files;
}

function findFiles(dir, basename) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, basename));
    } else if (entry.isFile() && entry.name === basename) {
      results.push(fullPath);
    }
  }
  return results;
}

class ComponentRegistry {
  constructor() {
    this.components = {};
  }

  register(info) {
    if (info.is_group) {
      return;
    }

    const normalized = { ...info };
    normalized.alias = asArray(normalized.alias);
    normalized.mwel_alias = asArray(normalized.mwel_alias);
    normalized.group = new Set(asArray(normalized.group));
    normalized.isa = new Set([normalized.name]);
    normalized.allowed_child = new Set(asArray(normalized.allowed_child));
    normalized.platform = asArray(normalized.platform);
    normalized.parameters = normalized.parameters ? [...normalized.parameters] : [];

    for (const ancestorName of asArray(info.isa)) {
      const ancestor = this.components[ancestorName];
      if (!ancestor) {
        throw new Error(`Unknown component ancestor '${ancestorName}' for '${info.name}'`);
      }
      for (const group of asArray(ancestor.group)) {
        normalized.group.add(group);
      }
      for (const name of asArray(ancestor.isa)) {
        normalized.isa.add(name);
      }
      for (const child of asArray(ancestor.allowed_child)) {
        normalized.allowed_child.add(child);
      }
      normalized.platform = [...asArray(ancestor.platform), ...normalized.platform];
      inheritParameters(normalized.parameters, ancestor.parameters || []);

      if (normalized.transient === undefined && ancestor.transient !== undefined) {
        normalized.transient = ancestor.transient;
      }
      if (normalized.toplevel === undefined && ancestor.toplevel !== undefined) {
        normalized.toplevel = ancestor.toplevel;
      }
    }

    normalized.group = [...normalized.group];
    normalized.isa = [...normalized.isa];
    normalized.allowed_child = [...normalized.allowed_child];
    if (normalized.platform.length === 0) {
      delete normalized.platform;
    }
    if (normalized.parameters.length === 0) {
      delete normalized.parameters;
    }
    if (normalized.alias.length === 0) {
      delete normalized.alias;
    }
    if (normalized.mwel_alias.length === 0) {
      delete normalized.mwel_alias;
    }

    this.components[normalized.name] = normalized;
  }
}

function inheritParameters(parameters, inheritedParameters) {
  const names = new Set(parameters.map((parameter) => parameter.name));
  for (const parameter of inheritedParameters) {
    if (!names.has(parameter.name)) {
      parameters.push(parameter);
      names.add(parameter.name);
    }
  }
}

function asArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

main();
