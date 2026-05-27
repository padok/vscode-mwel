#!/usr/bin/env python3
import argparse
import json
import os
import sys


def main():
    parser = argparse.ArgumentParser(description='VS Code bridge for MWorks MWEL tooling')
    parser.add_argument('command', choices=('validate', 'validate-stdin', 'format-stdin'))
    parser.add_argument('file', nargs='?')
    parser.add_argument('--vendor-path', default='')
    parser.add_argument('--components-json', default='')
    parser.add_argument('--mworks-path', default='')
    args = parser.parse_args()

    try:
        configure_import_path(args)
        import mwel

        components, metadata_available = load_components(args)
        mwel.get_component_info = lambda: components

        if args.command == 'validate':
            require_file(args)
            result = validate(args.file, metadata_available)
        elif args.command == 'validate-stdin':
            require_file(args)
            result = validate_source(args.file, sys.stdin.read(), metadata_available)
        else:
            require_file(args)
            result = format_source(args.file, sys.stdin.read(), metadata_available)
    except Exception as exc:
        result = {'ok': False, 'errors': [{'message': str(exc)}]}

    json.dump(result, sys.stdout)
    sys.stdout.write('\n')


def configure_import_path(args):
    candidates = []
    if args.vendor_path:
        candidates.append(args.vendor_path)
    if args.mworks_path:
        candidates.append(os.path.join(args.mworks_path, 'mwel'))
    candidates.extend([
        os.path.join(os.getcwd(), 'vendor'),
        os.path.join(os.getcwd(), 'mworks', 'mwel'),
        '/Library/Application Support/MWorks/MWEL',
    ])

    for candidate in candidates:
        if candidate and os.path.isdir(os.path.join(candidate, 'mwel')):
            sys.path.insert(0, candidate)
            return

    raise RuntimeError('Cannot find the MWorks MWEL Python package. Run npm run sync:mwel or configure mwel.mworksPath.')


def load_components(args):
    for path in component_candidates(args):
        if path and os.path.isfile(path):
            with open(path, encoding='utf-8') as fp:
                return json.load(fp), True
    return {}, False


def component_candidates(args):
    yield args.components_json
    if args.vendor_path:
        yield os.path.join(args.vendor_path, 'components.json')
    if args.mworks_path:
        yield os.path.join(args.mworks_path, 'Documentation', 'components.json')
        yield os.path.join(args.mworks_path, 'doc', 'components.json')
    yield os.environ.get('MWEL_COMPONENTS_JSON', '')
    yield os.path.join(os.getcwd(), 'vendor', 'components.json')
    yield '/Library/Application Support/MWorks/Documentation/components.json'


def require_file(args):
    if not args.file:
        raise RuntimeError('%s requires a file path' % args.command)


def validate(filepath, metadata_available):
    from mwel import ErrorLogger, readfile

    error_logger = ErrorLogger()
    src = readfile(filepath, error_logger)
    if src is None:
        errors = serialize_errors(error_logger.errors)
        return {
            'ok': not errors,
            'errors': errors,
            'metadataAvailable': metadata_available,
        }
    return validate_source(filepath, src, metadata_available)


def validate_source(filepath, src, metadata_available):
    from mwel import ErrorLogger
    from mwel.parser import Parser

    error_logger = ErrorLogger()
    if src is not None:
        sources = {filepath: src}
        module = Parser(error_logger).parse(src, os.path.dirname(filepath), sources)
        if module and metadata_available:
            from mwel.analyzer import Analyzer
            from mwel.validator import Validator

            components = Analyzer(error_logger).analyze(module)
            Validator(error_logger).validate(components)

    errors = serialize_errors(error_logger.errors)
    return {
        'ok': not errors,
        'errors': errors,
        'metadataAvailable': metadata_available,
    }


def format_source(filepath, src, metadata_available):
    if not metadata_available:
        return {
            'ok': False,
            'errors': [{
                'message': 'Cannot format MWEL without components.json metadata.',
            }],
            'metadataAvailable': False,
        }

    validation = validate_source(filepath, src, metadata_available)
    errors = validation['errors']
    result = {
        'ok': not errors,
        'errors': errors,
        'metadataAvailable': metadata_available,
    }
    if not errors:
        formatted = format_indentation(src or '')
        formatted_validation = validate_source(filepath, formatted, metadata_available)
        if formatted_validation['errors']:
            return formatted_validation
        result['formatted'] = formatted
    return result


def format_indentation(src):
    newline = '\r\n' if '\r\n' in src else '\n'
    ends_with_newline = src.endswith(('\n', '\r'))
    lines = src.splitlines()

    indent = 0
    in_block_comment = False
    formatted = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            formatted.append('')
            continue

        line_indent = indent
        if not in_block_comment and starts_with_closing_scope(stripped):
            line_indent = max(0, line_indent - 1)

        formatted_line = normalize_scope_spacing(stripped).rstrip()
        formatted.append((' ' * 4 * line_indent) + formatted_line)
        delta, in_block_comment = indentation_delta(formatted_line, in_block_comment)
        indent = max(0, indent + delta)

    result = newline.join(formatted)
    if ends_with_newline:
        result += newline
    return result


def indentation_delta(line, in_block_comment):
    delta = 0
    index = 0
    quote = None
    escape = False
    while index < len(line):
        char = line[index]
        next_char = line[index + 1] if index + 1 < len(line) else ''

        if in_block_comment:
            if char == '*' and next_char == '/':
                in_block_comment = False
                index += 2
                continue
            index += 1
            continue

        if quote:
            if escape:
                escape = False
            elif char == '\\':
                escape = True
            elif char == quote:
                quote = None
            index += 1
            continue

        if char in ('"', "'"):
            quote = char
            index += 1
            continue
        if char == '/' and next_char == '/':
            break
        if char == '/' and next_char == '*':
            in_block_comment = True
            index += 2
            continue
        if char == '{':
            delta += 1
        elif char == '}':
            delta -= 1
        elif char == '(':
            delta += 1
        elif char == ')':
            delta -= 1

        index += 1

    return delta, in_block_comment


def starts_with_closing_scope(line):
    return line.startswith(('}', ')'))


def normalize_scope_spacing(line):
    result = []
    index = 0
    quote = None
    escape = False
    in_block_comment = False
    while index < len(line):
        char = line[index]
        next_char = line[index + 1] if index + 1 < len(line) else ''

        if in_block_comment:
            result.append(char)
            if char == '*' and next_char == '/':
                result.append(next_char)
                in_block_comment = False
                index += 2
                continue
            index += 1
            continue

        if quote:
            result.append(char)
            if escape:
                escape = False
            elif char == '\\':
                escape = True
            elif char == quote:
                quote = None
            index += 1
            continue

        if char in ('"', "'"):
            quote = char
            result.append(char)
            index += 1
            continue
        if char == '/' and next_char == '/':
            result.append(line[index:])
            break
        if char == '/' and next_char == '*':
            in_block_comment = True
            result.append(char)
            result.append(next_char)
            index += 2
            continue

        if char in ('(', '{') and should_space_before_scope_opener(line, index):
            while result and result[-1] == ' ':
                result.pop()
            result.append(' ')

        result.append(char)
        index += 1

    return ''.join(result)


def should_space_before_scope_opener(line, index):
    if index == 0 or line[index - 1].isspace():
        return False

    prefix = line[:index].rstrip()
    if not prefix:
        return False

    if line[index] == '{':
        return True
    return prefix[-1].isalnum() or prefix[-1] in ('_', '/')


def serialize_errors(errors):
    return [serialize_error(error) for error in errors]


def serialize_error(error):
    return {
        'message': error.msg,
        'filename': normalize_location_value(error.filename),
        'lineno': normalize_location_value(error.lineno),
        'colno': normalize_location_value(error.colno),
    }


def normalize_location_value(value):
    if isinstance(value, tuple):
        return value[-1]
    return value


if __name__ == '__main__':
    main()