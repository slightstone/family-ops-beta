#!/usr/bin/env python3
"""Copy verified bundled runtime into a NEW local directory; no network or runtime access."""
import argparse, hashlib, json, os, stat
from pathlib import Path, PurePosixPath


def refuse(message):
    raise SystemExit(message)


def plain_ancestors(path):
    for p in [path, *path.parents]:
        try:
            mode = p.lstat().st_mode
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(mode) or not stat.S_ISDIR(mode):
            refuse('Choose an ordinary directory path without symlink ancestors.')


def prepare(destination):
    root = Path(__file__).absolute().parent.parent
    source = root / 'assets/site-template'
    plain_ancestors(source)
    manifest_path = root / 'source-manifest.json'
    if manifest_path.is_symlink():
        refuse('Unsafe source manifest; refused copy.')
    manifest = json.loads(manifest_path.read_text())
    expected = {}
    for entry in manifest['files']:
        name = entry['path']
        p = PurePosixPath(name)
        if not name or p.is_absolute() or '..' in p.parts or str(p) != name or '\\' in name or name in expected:
            refuse('Unsafe or duplicate source manifest path; refused copy.')
        expected[name] = entry
    data = {}
    for directory, dirs, files in os.walk(source, followlinks=False):
        for name in dirs + files:
            f = Path(directory) / name
            mode = f.lstat().st_mode
            if stat.S_ISLNK(mode) or not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
                refuse('Unsafe bundled source entry; refused copy.')
        for name in files:
            f = Path(directory) / name
            rel = f.relative_to(source).as_posix()
            fd = os.open(f, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd, 'rb') as stream:
                content = stream.read()
            entry = expected.get(rel)
            if not entry or len(content) != entry['bytes'] or hashlib.sha256(content).hexdigest() != entry['sha256']:
                refuse('Bundled source inventory/hash mismatch; refused copy.')
            data[rel] = content
    if set(data) != set(expected):
        refuse('Bundled source inventory mismatch; refused copy.')
    if 'project_id' in json.loads(data['.openai/hosting.json']):
        refuse('Template contains a Site identity; refused copy.')
    # Source bytes are now held in memory, so a later source substitution cannot affect the copy.
    dest = Path(os.path.abspath(os.path.expanduser(destination)))
    if dest == source or source in dest.parents or dest in source.parents:
        refuse('Destination must be outside the bundled template.')
    plain_ancestors(dest.parent)
    # Parent must already exist: no implicit path creation or merging with earlier work.
    parent = os.open(dest.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        try:
            os.mkdir(dest.name, mode=0o700, dir_fd=parent)
        except FileExistsError:
            refuse('Choose a new destination; existing work was not changed.')
        target = os.open(dest.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        try:
            for name, content in sorted(data.items()):
                parts = PurePosixPath(name).parts
                current = os.dup(target)
                try:
                    for part in parts[:-1]:
                        try:
                            os.mkdir(part, mode=0o700, dir_fd=current)
                        except FileExistsError:
                            pass
                        next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current)
                        os.close(current)
                        current = next_fd
                    fd = os.open(parts[-1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=current)
                    with os.fdopen(fd, 'wb') as stream:
                        stream.write(content)
                finally:
                    os.close(current)
        finally:
            os.close(target)
    finally:
        os.close(parent)
    print(json.dumps({'result':'verified-source-copied','sourceRevision':manifest['sourceRevision'],'files':len(data),'nativeSiteCreated':False,'sourceConnected':False}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', required=True, help='New directory under an existing ordinary parent directory')
    args = parser.parse_args()
    try:
        prepare(args.destination)
    except (OSError, ValueError, KeyError, TypeError) as error:
        refuse('Template preparation refused: ' + type(error).__name__ + '. Existing work was not overwritten; inspect any new partial destination before choosing another.')
