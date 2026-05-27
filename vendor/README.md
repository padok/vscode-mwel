# Generated MWEL Runtime

The `vendor/mwel` directory is generated from the MWorks submodule by running:

```sh
npm run sync:mwel
```

This also regenerates `vendor/components.json` from MWorks `MWComponents.yaml` documentation.

Do not edit generated MWEL files or metadata directly. Update the `mworks` submodule and rerun the sync script. Generated runtime files are ignored in git but included in VSIX packages.

MWorks is MIT licensed. See the upstream project for full details: https://github.com/mworks/mworks