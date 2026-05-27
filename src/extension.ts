import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

type BridgeError = {
  message: string;
  filename?: string;
  lineno?: number;
  colno?: number;
};

type ValidateResult = {
  ok: boolean;
  errors: BridgeError[];
  metadataAvailable?: boolean;
  formatted?: string;
};

type ComponentParameter = {
  name?: string;
  required?: string | boolean;
};

type ComponentInfo = {
  name?: string;
  signature?: string;
  alias?: string | string[];
  mwel_alias?: string | string[];
  description?: string;
  parameters?: ComponentParameter[];
};

type ComponentIndex = {
  byToken: Map<string, ComponentInfo>;
};

const diagnostics = vscode.languages.createDiagnosticCollection('mwel');
const validationTimers = new Map<string, ReturnType<typeof setTimeout>>();
let cachedComponentIndex: { key: string; index: ComponentIndex } | undefined;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(diagnostics);

  context.subscriptions.push(
    vscode.commands.registerCommand('mwel.validateCurrentFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'mwel') {
        vscode.window.showInformationMessage('Open an MWEL file to validate it.');
        return;
      }
      await validateDocument(context, editor.document, true);
    })
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider('mwel', {
      provideHover(document, position) {
        return provideComponentHover(context, document, position);
      }
    })
  );

  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider('mwel', {
      provideDocumentFormattingEdits(document) {
        return provideDocumentFormattingEdits(context, document);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('mwel.componentsJsonPath') || event.affectsConfiguration('mwel.mworksPath')) {
        cachedComponentIndex = undefined;
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (document.languageId === 'mwel' && getConfiguration().get<boolean>('validateOnSave', true)) {
        await validateDocument(context, document, false);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const document = event.document;
      if (document.languageId === 'mwel' && getConfiguration().get<boolean>('validateOnChange', true)) {
        scheduleValidation(context, document);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnostics.delete(document.uri);
      clearScheduledValidation(document);
    })
  );

  for (const document of vscode.workspace.textDocuments) {
    if (document.languageId === 'mwel' && document.uri.scheme === 'file') {
      void validateDocument(context, document, false);
    }
  }
}

export function deactivate(): void {
  for (const timer of validationTimers.values()) {
    clearTimeout(timer);
  }
  validationTimers.clear();
  diagnostics.dispose();
}

function scheduleValidation(context: vscode.ExtensionContext, document: vscode.TextDocument): void {
  clearScheduledValidation(document);
  const delay = getConfiguration().get<number>('validateOnChangeDelay', 100);
  const timer = setTimeout(() => {
    validationTimers.delete(document.uri.toString());
    void validateDocument(context, document, false);
  }, Math.max(0, delay));
  validationTimers.set(document.uri.toString(), timer);
}

function clearScheduledValidation(document: vscode.TextDocument): void {
  const key = document.uri.toString();
  const timer = validationTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    validationTimers.delete(key);
  }
}

async function validateDocument(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  showStatus: boolean
): Promise<void> {
  if (document.uri.scheme !== 'file') {
    return;
  }

  const documentVersion = document.version;

  try {
    const result = await runBridge(context, 'validate-stdin', document.uri.fsPath, document.getText());
    if (!isCurrentDocument(document, documentVersion)) {
      return;
    }

    applyDiagnostics(document, result.errors);

    if (showStatus) {
      if (result.ok) {
        const suffix = result.metadataAvailable ? '' : ' Parser-only mode: no components.json configured.';
        vscode.window.showInformationMessage(`MWEL validation passed.${suffix}`);
      } else {
        vscode.window.showWarningMessage(`MWEL validation found ${result.errors.length} issue(s).`);
      }
    }
  } catch (error) {
    if (!isCurrentDocument(document, documentVersion)) {
      return;
    }

    diagnostics.delete(document.uri);
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`MWEL validation failed: ${message}`);
  }
}

function isCurrentDocument(document: vscode.TextDocument, version: number): boolean {
  return !document.isClosed && document.version === version;
}

async function provideDocumentFormattingEdits(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument
): Promise<vscode.TextEdit[]> {
  if (document.uri.scheme !== 'file') {
    return [];
  }

  const documentVersion = document.version;
  try {
    const result = await runBridge(context, 'format-stdin', document.uri.fsPath, document.getText());
    if (!isCurrentDocument(document, documentVersion)) {
      return [];
    }

    applyDiagnostics(document, result.errors);
    if (!result.ok) {
      vscode.window.showWarningMessage(`MWEL formatting failed with ${result.errors.length} issue(s).`);
      return [];
    }
    if (result.formatted === undefined || result.formatted === document.getText()) {
      return [];
    }

    const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
    return [vscode.TextEdit.replace(fullRange, result.formatted)];
  } catch (error) {
    if (!isCurrentDocument(document, documentVersion)) {
      return [];
    }

    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`MWEL formatting failed: ${message}`);
    return [];
  }
}

function applyDiagnostics(document: vscode.TextDocument, errors: BridgeError[]): void {
  const currentFile = path.normalize(document.uri.fsPath);
  const currentDir = path.dirname(currentFile);
  const currentDiagnostics: vscode.Diagnostic[] = [];

  for (const error of errors) {
    const filename = error.filename ? resolveDiagnosticPath(error.filename, currentDir) : currentFile;
    if (path.normalize(filename) !== currentFile) {
      continue;
    }

    const line = Math.max(0, (error.lineno ?? 1) - 1);
    const character = Math.max(0, (error.colno ?? 1) - 1);
    const range = new vscode.Range(line, character, line, character + 1);
    currentDiagnostics.push(new vscode.Diagnostic(range, error.message, vscode.DiagnosticSeverity.Error));
  }

  diagnostics.set(document.uri, currentDiagnostics);
}

function resolveDiagnosticPath(filename: string, currentDir: string): string {
  if (path.isAbsolute(filename)) {
    return filename;
  }
  return path.resolve(currentDir, filename);
}

function provideComponentHover(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  position: vscode.Position
): vscode.Hover | undefined {
  const range = document.getWordRangeAtPosition(position, /[A-Za-z][A-Za-z0-9_]*(\/[A-Za-z][A-Za-z0-9_]*)?/);
  if (!range) {
    return undefined;
  }

  const token = document.getText(range);
  const component = loadComponentIndex(context).byToken.get(token);
  if (!component) {
    return undefined;
  }

  const contents = componentToMarkdown(component);
  return contents ? new vscode.Hover(contents, range) : undefined;
}

function loadComponentIndex(context: vscode.ExtensionContext): ComponentIndex {
  const metadataPath = resolveComponentsJsonPath(context);
  const cacheKey = metadataPath || '';
  if (cachedComponentIndex?.key === cacheKey) {
    return cachedComponentIndex.index;
  }

  const components = readComponentsJson(metadataPath);
  const index = buildComponentIndex(components);
  cachedComponentIndex = { key: cacheKey, index };
  return index;
}

function resolveComponentsJsonPath(context: vscode.ExtensionContext): string | undefined {
  const configuration = getConfiguration();
  const configuredComponentsJson = configuration.get<string>('componentsJsonPath', '');
  if (configuredComponentsJson && fs.existsSync(configuredComponentsJson)) {
    return configuredComponentsJson;
  }

  const mworksPath = configuration.get<string>('mworksPath', '');
  const mworksCandidates = mworksPath
    ? [
        path.join(mworksPath, 'Documentation', 'components.json'),
        path.join(mworksPath, 'doc', 'components.json')
      ]
    : [];

  const candidates = [
    ...mworksCandidates,
    path.join(context.asAbsolutePath('vendor'), 'components.json'),
    '/Library/Application Support/MWorks/Documentation/components.json'
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

function readComponentsJson(metadataPath: string | undefined): Record<string, ComponentInfo> {
  if (!metadataPath) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as Record<string, ComponentInfo>;
  } catch {
    return {};
  }
}

function buildComponentIndex(components: Record<string, ComponentInfo>): ComponentIndex {
  const byToken = new Map<string, ComponentInfo>();
  const shortTypenames = new Map<string, ComponentInfo[]>();

  for (const component of Object.values(components)) {
    if (!component.signature) {
      continue;
    }

    byToken.set(component.signature, component);
    for (const alias of [...asArray(component.alias), ...asArray(component.mwel_alias)]) {
      byToken.set(alias, component);
    }

    const signatureParts = component.signature.split('/');
    if (signatureParts.length > 1) {
      const shortName = signatureParts[1];
      const entries = shortTypenames.get(shortName) || [];
      entries.push(component);
      shortTypenames.set(shortName, entries);
    }
  }

  for (const [shortName, entries] of shortTypenames) {
    if (entries.length === 1 && !byToken.has(shortName)) {
      byToken.set(shortName, entries[0]);
    }
  }

  return { byToken };
}

function componentToMarkdown(component: ComponentInfo): vscode.MarkdownString | undefined {
  const title = component.name || component.signature;
  if (!title) {
    return undefined;
  }

  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.supportHtml = false;
  markdown.isTrusted = false;
  markdown.appendMarkdown(`**${escapeMarkdown(title)}**`);

  if (component.signature) {
    markdown.appendMarkdown(`\n\n\`${component.signature}\``);
  }

  const description = cleanDocumentation(component.description);
  if (description) {
    markdown.appendMarkdown(`\n\n${description}`);
  }

  const requiredParameters = (component.parameters || [])
    .filter((parameter) => parameter.name && isRequiredParameter(parameter))
    .slice(0, 8)
    .map((parameter) => `\`${parameter.name}\``);
  if (requiredParameters.length > 0) {
    markdown.appendMarkdown(`\n\nRequired: ${requiredParameters.join(', ')}`);
  }

  return markdown;
}

function cleanDocumentation(text: string | undefined): string {
  if (!text) {
    return '';
  }

  return text
    .replace(/``([^`]+)``/g, '`$1`')
    .replace(/`([^`<]+?)\s*<[^>]+>`_/g, '$1')
    .replace(/`([^`]+)`_/g, '$1')
    .replace(/:term:`([^`]+)`/g, '$1')
    .replace(/:ref:`([^`<]+?)\s*<[^>]+>`/g, '$1')
    .replace(/:ref:`([^`]+)`/g, '$1')
    .replace(/\.\.\s+rubric::\s*/g, '**')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!])/g, '\\$1');
}

function isRequiredParameter(parameter: ComponentParameter): boolean {
  return parameter.required === true || parameter.required === 'yes';
}

function asArray(value: string | string[] | undefined): string[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function runBridge(
  context: vscode.ExtensionContext,
  command: string,
  filePath: string,
  source?: string
): Promise<ValidateResult> {
  const configuration = getConfiguration();
  const pythonPath = configuration.get<string>('pythonPath', 'python');
  const componentsJsonPath = configuration.get<string>('componentsJsonPath', '');
  const mworksPath = configuration.get<string>('mworksPath', '');
  const bridgePath = context.asAbsolutePath(path.join('python', 'mwel_bridge.py'));
  const vendorPath = context.asAbsolutePath('vendor');

  const args = [bridgePath, command, filePath, '--vendor-path', vendorPath];
  if (componentsJsonPath) {
    args.push('--components-json', componentsJsonPath);
  }
  if (mworksPath) {
    args.push('--mworks-path', mworksPath);
  }

  return new Promise((resolve, reject) => {
    const child = cp.spawn(pythonPath, args, {
      cwd: path.dirname(filePath),
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8'
      }
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (stdout += chunk));
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', () => {
      try {
        resolve(JSON.parse(stdout) as ValidateResult);
      } catch (parseError) {
        reject(new Error(stderr.trim() || stdout.trim() || String(parseError)));
      }
    });

    if (source !== undefined) {
      child.stdin.end(source);
    }
  });
}

function getConfiguration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('mwel');
}