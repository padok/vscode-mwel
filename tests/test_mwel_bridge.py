import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / 'python' / 'mwel_bridge.py'
VENDOR = ROOT / 'vendor'
SIMPLE_FIXTURE = ROOT / 'test-fixtures' / 'simple.mwel'


class MwelBridgeTests(unittest.TestCase):

    def run_bridge(self, *args):
        completed = subprocess.run(
            [sys.executable, str(BRIDGE), *args, '--vendor-path', str(VENDOR)],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
        try:
            return json.loads(completed.stdout)
        except json.JSONDecodeError as exc:
            self.fail('Bridge did not return JSON: %s\nstdout: %s\nstderr: %s' % (
                exc,
                completed.stdout,
                completed.stderr,
            ))

    def assert_unknown_component_diagnostic(self, result):
        self.assertFalse(result['ok'], result)
        self.assertTrue(result['metadataAvailable'])
        self.assertGreater(len(result['errors']), 0)
        self.assertIn('not a valid component type signature', result['errors'][0]['message'])

    def test_validate_accepts_valid_mwel_with_bundled_component_metadata(self):
        result = self.run_bridge('validate', str(SIMPLE_FIXTURE))

        self.assertTrue(result['ok'], result)
        self.assertEqual([], result['errors'])
        self.assertTrue(result['metadataAvailable'])

    def test_validate_stdin_reports_unsaved_parser_errors(self):
        completed = subprocess.run(
            [
                sys.executable,
                str(BRIDGE),
                'validate-stdin',
                str(SIMPLE_FIXTURE),
                '--vendor-path',
                str(VENDOR),
            ],
            cwd=ROOT,
            input="protocol 'Broken' {\n    if (\n}\n",
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )

        result = json.loads(completed.stdout)
        self.assertFalse(result['ok'], result)
        self.assertGreater(len(result['errors']), 0)
        self.assertIsInstance(result['errors'][0]['lineno'], int)
        self.assertIsInstance(result['errors'][0]['colno'], int)

    def test_bundled_component_metadata_reports_unknown_component_names(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            unknown_file = Path(temp_dir) / 'unknown.mwel'
            unknown_file.write_text(
                "unknown_widget 'Example' {}\n", encoding='utf-8')

            result = self.run_bridge('validate', str(unknown_file))

        self.assert_unknown_component_diagnostic(result)

    def test_vendor_path_component_metadata_works_outside_repo_root(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            unknown_file = Path(temp_dir) / 'unknown.mwel'
            unknown_file.write_text(
                "unknown_widget 'Example' {}\n", encoding='utf-8')

            completed = subprocess.run(
                [
                    sys.executable,
                    str(BRIDGE),
                    'validate',
                    str(unknown_file),
                    '--vendor-path',
                    str(VENDOR),
                ],
                cwd=temp_dir,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
            )

        result = json.loads(completed.stdout)
        self.assert_unknown_component_diagnostic(result)

    def test_validate_stdin_reports_unknown_components_with_bundled_metadata(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source_file = Path(temp_dir) / 'unsaved_unknown.mwel'
            completed = subprocess.run(
                [
                    sys.executable,
                    str(BRIDGE),
                    'validate-stdin',
                    str(source_file),
                    '--vendor-path',
                    str(VENDOR),
                ],
                cwd=temp_dir,
                input="unknown_widget 'Unsaved' {}\n",
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
            )

        result = json.loads(completed.stdout)
        self.assert_unknown_component_diagnostic(result)

    def test_validate_reports_parser_errors(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            broken_file = Path(temp_dir) / 'broken.mwel'
            broken_file.write_text(
                "protocol 'Broken' {\n    if (\n}\n", encoding='utf-8')

            result = self.run_bridge('validate', str(broken_file))

        self.assertFalse(result['ok'], result)
        self.assertGreater(len(result['errors']), 0)
        self.assertIn('message', result['errors'][0])
        self.assertIsInstance(result['errors'][0]['lineno'], int)
        self.assertIsInstance(result['errors'][0]['colno'], int)

    def test_validate_uses_configured_components_json(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            components_file = Path(temp_dir) / 'components.json'
            components = {
                'Custom Action': {
                    'name': 'Custom Action',
                    'signature': 'action/custom',
                    'isa': ['Action'],
                    'parameters': [],
                },
            }
            components_file.write_text(
                json.dumps(components), encoding='utf-8')

            source_file = Path(temp_dir) / 'configured_metadata.mwel'
            source_file.write_text(
                "protocol 'Configured' {\n    custom ()\n}\n", encoding='utf-8')

            result = self.run_bridge(
                'validate',
                str(source_file),
                '--components-json',
                str(components_file),
            )

        self.assertTrue(result['ok'], result)
        self.assertTrue(result['metadataAvailable'])
        self.assertEqual([], result['errors'])

    def test_format_stdin_preserves_comments_and_blank_lines(self):
        source = """\
// Keep this header

iodevice/mio mIO (
reconnect_interval = 10s
data_interval = 1ms
reward_a = IO_rewardB
reward_b = IO_rewardA
touch_x_calib = TOUCH_x_dva
touch_y_calib = TOUCH_y_dva
)

protocol 'Test Protocol' {
if (x > 1) {
// Keep this nested note
update_stimulus_display()
start_timer(
timer = sample_timer
)
report('x is greater than 1!')
x = 2*(3 + 4)
}
}

experiment 'My Experiment'{
}
"""
        completed = subprocess.run(
            [
                sys.executable,
                str(BRIDGE),
                'format-stdin',
                str(SIMPLE_FIXTURE),
                '--vendor-path',
                str(VENDOR),
            ],
            cwd=ROOT,
            input=source,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )

        result = json.loads(completed.stdout)
        self.assertTrue(result['ok'], result)
        self.assertTrue(result['metadataAvailable'])
        self.assertEqual([], result['errors'])
        self.assertIn('// Keep this header\n\n', result['formatted'])
        self.assertIn('iodevice/mio mIO (\n    reconnect_interval = 10s', result['formatted'])
        self.assertIn('    touch_y_calib = TOUCH_y_dva\n)', result['formatted'])
        self.assertIn('    if (x > 1) {', result['formatted'])
        self.assertIn('        // Keep this nested note', result['formatted'])
        self.assertIn('        update_stimulus_display ()', result['formatted'])
        self.assertIn('        start_timer (\n            timer = sample_timer\n        )', result['formatted'])
        self.assertIn("        report ('x is greater than 1!')", result['formatted'])
        self.assertIn('        x = 2*(3 + 4)', result['formatted'])
        self.assertIn("experiment 'My Experiment' {", result['formatted'])
        self.assertNotIn('// Protocols', result['formatted'])
        self.assertIn("protocol 'Test Protocol'", result['formatted'])

        with tempfile.TemporaryDirectory() as temp_dir:
            formatted_file = Path(temp_dir) / 'formatted.mwel'
            formatted_file.write_text(result['formatted'], encoding='utf-8')
            validate_result = self.run_bridge('validate', str(formatted_file))

        self.assertTrue(validate_result['ok'], validate_result)

        second_result = self.run_format_stdin(result['formatted'])

        self.assertTrue(second_result['ok'], second_result)
        self.assertEqual([], second_result['errors'])
        self.assertEqual(result['formatted'], second_result['formatted'])

    def test_format_stdin_refuses_invalid_mwel(self):
        completed = subprocess.run(
            [
                sys.executable,
                str(BRIDGE),
                'format-stdin',
                str(SIMPLE_FIXTURE),
                '--vendor-path',
                str(VENDOR),
            ],
            cwd=ROOT,
            input="protocol 'Broken' {\n    if (\n}\n",
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )

        result = json.loads(completed.stdout)
        self.assertFalse(result['ok'], result)
        self.assertGreater(len(result['errors']), 0)
        self.assertNotIn('formatted', result)

    def run_format_stdin(self, source):
        completed = subprocess.run(
            [
                sys.executable,
                str(BRIDGE),
                'format-stdin',
                str(SIMPLE_FIXTURE),
                '--vendor-path',
                str(VENDOR),
            ],
            cwd=ROOT,
            input=source,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
        return json.loads(completed.stdout)


if __name__ == '__main__':
    unittest.main()
