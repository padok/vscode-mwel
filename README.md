# vscode-mwel README

This extension adds language support for mWorks Experiment Language (MWEL) to Visual Studio Code.

[Visual Studio Code - Marketplace](https://marketplace.visualstudio.com/items?itemName=padok.vscode-mwel)

## Features

- Syntax highlighting for `.mwel` files.
- Live MWEL parser diagnostics for unsaved editor contents via the canonical MWorks MWEL Python parser.
- Component validation via bundled metadata generated from MWorks `MWComponents.yaml` documentation.
- Component hover documentation from generated MWorks component metadata.
- Full-document formatting that validates with MWorks, then preserves source comments and blank lines while fixing indentation.
- Optional override with a local MWorks `components.json` file.

## Extension Settings

- `mwel.pythonPath`: Python executable used to run the MWEL bridge. Defaults to `python`.
- `mwel.componentsJsonPath`: Optional path to MWorks `components.json`.
- `mwel.mworksPath`: Optional path to a local MWorks checkout or installation.
- `mwel.validateOnSave`: Validate MWEL files when saved. Defaults to `true`.
- `mwel.validateOnChange`: Validate unsaved MWEL changes after a short delay. Defaults to `true`.
- `mwel.validateOnChangeDelay`: Delay in milliseconds before validating unsaved MWEL changes. Defaults to `100`.

## Development

The `mworks` submodule is the development-time source of truth for MWorks-derived runtime files. `npm test` and `npm run package` regenerate the upstream MWEL Python package under `vendor/mwel`, component metadata under `vendor/components.json`, and component highlighting rules in `syntaxes/mwel.tmLanguage.json` before they run, so generated runtime output does not need to be maintained by hand.

```sh
git submodule update --init mworks
npm install
npm run compile
npm test
npm run package
```

The generated `vendor/mwel` and `vendor/components.json` files are ignored in git but included in packaged VSIX builds. Diagnostics, hover documentation, and component-name highlighting all use metadata generated from the submodule, so MWorks component changes flow into those editor features when the sync/package flow runs. Users of the extension do not need the submodule.

The test suite covers the Python MWEL bridge, parser error reporting, configured metadata validation, formatting, extension manifest wiring, and TextMate grammar tokenization.

Formatting is available through VS Code's standard Format Document command. It validates with the MWorks parser, analyzer, and validator before editing, then conservatively fixes indentation in the original source. Comments, blank lines, aliases, parameter order, and section layout are preserved. It refuses to format files with parser, analyzer, or validator errors.

GitHub releases are created automatically for version tags such as `v0.2.0`, with the packaged `.vsix` attached. To publish on the VS Code Marketplace, upload the release `.vsix` manually from the Marketplace management page.

## Known Issues

- Validation uses MWorks parser/analyzer/validator code plus bundled component metadata generated from the MWorks docs. It still does not run MWorks or prove that an experiment can be loaded on a specific rig. For exact runtime behavior, validate with MWorks itself.

## License

This extension heavily borrows from [cstawarz's repository](https://github.com/cstawarz/mwel_sublime) for Sublime.

Icon by [Freepik](https://www.flaticon.com/authors/freepik) from [Flaticon](https://www.flaticon.com/).

## Author

Louis Frank (a.k.a. padok)
