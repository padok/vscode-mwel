import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PACKAGE_JSON = ROOT / 'package.json'


class PackageManifestTests(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.package = json.loads(PACKAGE_JSON.read_text(encoding='utf-8'))

    def test_extension_host_entrypoint_is_configured(self):
        self.assertEqual('./out/extension.js', self.package['main'])
        self.assertIn('onLanguage:mwel', self.package['activationEvents'])
        self.assertIn('onCommand:mwel.validateCurrentFile', self.package['activationEvents'])

    def test_mwel_language_and_grammar_are_contributed(self):
        languages = self.package['contributes']['languages']
        grammars = self.package['contributes']['grammars']

        self.assertIn(
            {
                'id': 'mwel',
                'aliases': ['MWEL', 'mwel'],
                'extensions': ['.mwel'],
                'configuration': './language-configuration.json',
            },
            languages,
        )
        self.assertIn(
            {
                'language': 'mwel',
                'scopeName': 'source.mwel',
                'path': './syntaxes/mwel.tmLanguage.json',
            },
            grammars,
        )

    def test_validation_command_and_settings_are_contributed(self):
        commands = self.package['contributes']['commands']
        settings = self.package['contributes']['configuration']['properties']

        self.assertIn(
            {
                'command': 'mwel.validateCurrentFile',
                'title': 'Validate Current File',
                'category': 'MWEL',
            },
            commands,
        )
        self.assertIn('mwel.pythonPath', settings)
        self.assertIn('mwel.componentsJsonPath', settings)
        self.assertIn('mwel.mworksPath', settings)
        self.assertIn('mwel.validateOnSave', settings)
        self.assertIn('mwel.validateOnChange', settings)
        self.assertIn('mwel.validateOnChangeDelay', settings)
        self.assertTrue(settings['mwel.validateOnSave']['default'])
        self.assertTrue(settings['mwel.validateOnChange']['default'])
        self.assertEqual(100, settings['mwel.validateOnChangeDelay']['default'])


if __name__ == '__main__':
    unittest.main()
