#!/usr/bin/env python3
import os
import shutil


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, 'mworks', 'mwel', 'mwel')
DESTINATION = os.path.join(ROOT, 'vendor', 'mwel')


def main():
    if not os.path.isdir(SOURCE):
        raise SystemExit('MWorks submodule is not initialized. Run: git submodule update --init mworks')

    if os.path.isdir(DESTINATION):
        shutil.rmtree(DESTINATION)

    shutil.copytree(
        SOURCE,
        DESTINATION,
        ignore=shutil.ignore_patterns('__pycache__', '*.pyc'),
    )

    print('Synced %s -> %s' % (SOURCE, DESTINATION))


if __name__ == '__main__':
    main()