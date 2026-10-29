#!/usr/bin/env python3
"""Read-only verification of the generic beta payload; never reads board state."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def ordinary_directory(value):
    path = Path(os.path.abspath(value))
    for item in (path, *path.parents):
        if item.is_symlink():
            raise ValueError("symlink in the supplied path")
    if not path.is_dir():
        raise ValueError("supplied directory is unavailable")
    return path


def verify(manifest, plugin_root, expected_digest):
    if len(expected_digest) != 64 or any(c not in "0123456789abcdef" for c in expected_digest):
        raise ValueError("invalid expected map digest")
    manifest_path = Path(os.path.abspath(manifest))
    ordinary_directory(manifest_path.parent)
    if manifest_path.is_symlink() or not manifest_path.is_file() or manifest_path.stat().st_size > 200000:
        raise ValueError("manifest is not a bounded ordinary file")
    data = json.loads(manifest_path.read_text())
    entries = data.get("files")
    if not isinstance(entries, list) or len(entries) != 342:
        raise ValueError("unexpected payload inventory")
    if hashlib.sha256(canonical(entries)).hexdigest() != expected_digest:
        raise ValueError("payload inventory does not match the approved release")
    expected = {}
    for entry in entries:
        name = entry.get("path", "")
        path = PurePosixPath(name)
        if not name or path.is_absolute() or ".." in path.parts or "\\" in name or str(path) != name or name in expected:
            raise ValueError("unsafe or repeated inventory path")
        if not isinstance(entry.get("bytes"), int) or entry["bytes"] < 0 or not isinstance(entry.get("sha256"), str):
            raise ValueError("invalid file inventory")
        expected[name] = entry
    root = ordinary_directory(plugin_root)
    actual = {}
    for directory, subdirs, files in os.walk(root, followlinks=False):
        for name in subdirs:
            if (Path(directory) / name).is_symlink():
                raise ValueError("symlink directory in payload")
        for name in files:
            file = Path(directory) / name
            mode = file.lstat().st_mode
            if not stat.S_ISREG(mode):
                raise ValueError("non-ordinary file in payload")
            relative = file.relative_to(root).as_posix()
            if relative not in expected:
                raise ValueError("unexpected file in payload")
            if file.stat().st_size != expected[relative]["bytes"]:
                raise ValueError("payload file size mismatch")
            actual[relative] = hashlib.sha256(file.read_bytes()).hexdigest()
    if set(actual) != set(expected):
        raise ValueError("missing payload file")
    if any(actual[name] != entry["sha256"] for name, entry in expected.items()):
        raise ValueError("payload file hash mismatch")
    plugin = json.loads((root / "plugin.json").read_text())
    if (plugin.get("name"), plugin.get("version")) != ("family-ops", "0.3.0"):
        raise ValueError("unexpected plugin identity")
    return {"verified": True, "files": len(actual), "name": "family-ops", "version": "0.3.0", "mapSha256": expected_digest}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--plugin-root", required=True)
    parser.add_argument("--expected-map-sha256", required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.manifest, args.plugin_root, args.expected_map_sha256)))
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"verified": False, "error": str(error)}))
        raise SystemExit(1)
