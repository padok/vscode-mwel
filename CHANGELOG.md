# Change Log

## 0.2.0 - 2026-05-27

+ Add a TypeScript extension host for MWEL commands and diagnostics.
+ Add a Python bridge that reuses the upstream MWorks MWEL parser, plus analyzer and validator when component metadata is configured.
+ Add live parser diagnostics for unsaved MWEL changes and validate the active editor buffer from the manual command.
+ Add component hover documentation generated from MWorks component metadata.
+ Add full-document formatting that validates with MWorks and conservatively preserves source comments and layout.
+ Generate component-name highlighting rules from MWorks component metadata.
+ Add generation workflow for the MWorks MWEL Python package and component metadata from the `mworks` submodule, keeping generated runtime output out of source control.
+ Add automated tests for bridge diagnostics, metadata discovery, extension manifest wiring, and TextMate grammar tokenization.
+ Add GitHub Actions workflows for CI packaging and GitHub Release VSIX uploads.

## 0.1.0 - 2022-10-06

+ Initial release
+ Syntax highlighting

## 0.1.1 - 2022-10-06

+ new icon