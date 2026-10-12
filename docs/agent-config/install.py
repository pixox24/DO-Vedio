#!/usr/bin/env python3
"""Validate or install this package; keep private global configuration out of Git."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import tomllib
from datetime import datetime


SOURCE = Path(__file__).resolve().parent
SUPPORTED_FIELDS = {
    "name", "description", "developer_instructions",
    "model", "model_reasoning_effort", "sandbox_mode",
}


def digest(content):
    return hashlib.sha256(content).hexdigest()


def scalar(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    return json.dumps(value, ensure_ascii=False)


def update_block(block, values):
    for key, value in values.items():
        pattern = rf"(?m)^[ \t]*{re.escape(key)}[ \t]*=[^\n]*$"
        matches = list(re.finditer(pattern, block))
        if len(matches) > 1:
            raise ValueError(f"Duplicate setting: {key}")
        line = f"{key} = {scalar(value)}"
        if matches:
            block = re.sub(pattern, lambda _: line, block)
        else:
            block = block.rstrip() + "\n" + line + "\n"
    return block


def merge_policy(original, policy):
    # Modify only the root model settings and the controlled [agents] keys.
    header_pattern = r"(?m)^[ \t]*\[(?!\[)([^\]\n]+)\][ \t]*(?:#.*)?$"
    headers = list(re.finditer(header_pattern, original))
    root_end = headers[0].start() if headers else len(original)
    candidate = update_block(original[:root_end], {
        "model": policy["model"],
        "model_reasoning_effort": policy["model_reasoning_effort"],
    }) + original[root_end:]
    headers = list(re.finditer(header_pattern, candidate))
    agents_header = next((h for h in headers if h.group(1).strip() == "agents"), None)
    if agents_header:
        index = headers.index(agents_header)
        end = headers[index + 1].start() if index + 1 < len(headers) else len(candidate)
        start = agents_header.end()
        candidate = candidate[:start] + update_block(candidate[start:end], policy["agents"]) + candidate[end:]
    else:
        candidate = candidate.rstrip() + "\n\n[agents]\n"
        candidate += "\n".join(f"{k} = {scalar(v)}" for k, v in policy["agents"].items()) + "\n"

    before = tomllib.loads(original)
    after = tomllib.loads(candidate)
    expected = dict(before)
    expected["model"] = policy["model"]
    expected["model_reasoning_effort"] = policy["model_reasoning_effort"]
    expected["agents"] = {**before.get("agents", {}), **policy["agents"]}
    if after != expected:
        raise ValueError("Unrelated configuration would change; installation stopped")
    return candidate


def prepare(target):
    policy = tomllib.loads((SOURCE / "config.policy.toml").read_text())
    roles = json.loads((SOURCE / "roles.json").read_text())
    names = {r["name"] for r in roles}
    if len(names) != 19 or len(roles) != 19:
        raise ValueError("Expected 19 unique Agent roles")
    if {p.stem for p in (SOURCE / "agents").glob("*.toml")} != names:
        raise ValueError("Agent files do not match the role index")
    if policy["model"] != "gpt-6.1-sol" or policy["model_reasoning_effort"] != "ultra":
        raise ValueError("Unexpected main model policy")
    if policy["agents"] != {
        "enabled": True,
        "max_concurrent_threads_per_session": 3,
        "default_subagent_model": "gpt-6.1-sol",
        "default_subagent_reasoning_effort": "ultra",
    }:
        raise ValueError("Unexpected subagent policy")

    files = {}
    for role in roles:
        path = SOURCE / "agents" / (role["name"] + ".toml")
        content = path.read_bytes()
        config = tomllib.loads(content.decode())
        if set(config) != SUPPORTED_FIELDS or config["name"] != role["name"]:
            raise ValueError("Invalid Agent fields: " + path.name)
        if config["model"] != "gpt-6.1-sol" or config["model_reasoning_effort"] not in {"high", "ultra"}:
            raise ValueError("Invalid Agent model policy: " + path.name)
        for key, index_key in [("model", "model"), ("model_reasoning_effort", "effort"), ("sandbox_mode", "sandbox")]:
            if config[key] != role[index_key]:
                raise ValueError("Agent index mismatch: " + path.name)
        if config["sandbox_mode"] not in {"read-only", "workspace-write"}:
            raise ValueError("Invalid sandbox: " + path.name)
        if config["sandbox_mode"] == "read-only" and (config["model_reasoning_effort"] != "ultra" or role["allowed_files"]):
            raise ValueError("Reviewer must be ultra and have no write scope: " + path.name)
        for allowed in role["allowed_files"]:
            if "- " + allowed + "\n" not in config["developer_instructions"] + "\n":
                raise ValueError("Agent scope index mismatch: " + path.name)
        files["agents/" + path.name] = content

    # Snapshot every old role, including unrelated roles, for a complete backup.
    originals = {"config.toml": (target / "config.toml").read_bytes()}
    originals.update({"agents/" + p.name: p.read_bytes() for p in (target / "agents").glob("*.toml")})
    files["config.toml"] = merge_policy(originals["config.toml"].decode(), policy).encode()
    return roles, originals, files


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def install(target, originals, files):
    current_names = {"agents/" + p.name for p in (target / "agents").glob("*.toml")}
    if current_names != {k for k in originals if k.startswith("agents/")}:
        raise ValueError("Agent directory changed while preparing; retry after reviewing changes")
    for relative, content in originals.items():
        if (target / relative).read_bytes() != content:
            raise ValueError("Configuration changed while preparing: " + relative)

    backup = target / "backups" / ("sol61-agents-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f"))
    backup.mkdir(parents=True, mode=0o700)
    os.chmod(backup, 0o700)
    for relative, content in originals.items():
        atomic_write(backup / relative, content)
    manifest = {
        "original_hashes": {k: digest(v) for k, v in originals.items()},
        "installed_paths": list(files),
        "new_paths": sorted(set(files) - set(originals)),
    }
    atomic_write(backup / "manifest.json", (json.dumps(manifest, indent=2) + "\n").encode())
    written = []
    try:
        for relative in sorted(k for k in files if k.startswith("agents/")) + ["config.toml"]:
            atomic_write(target / relative, files[relative])
            written.append(relative)
        for relative, content in files.items():
            if (target / relative).read_bytes() != content:
                raise ValueError("Installed file differs: " + relative)
    except BaseException:
        for relative in reversed(written):
            if relative in originals:
                atomic_write(target / relative, originals[relative])
            else:
                (target / relative).unlink(missing_ok=True)
        raise
    return backup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="Validate without writing; default")
    mode.add_argument("--apply", action="store_true", help="Back up and install the prepared configuration")
    parser.add_argument("--target", type=Path, default=Path.home() / ".codex", help="Codex configuration directory")
    args = parser.parse_args()
    roles, originals, files = prepare(args.target)
    report = {
        "validated": True,
        "installed": False,
        "target": str(args.target),
        "agents": len(roles),
        "read_only_reviewers": sum(r["sandbox"] == "read-only" for r in roles),
        "model": "gpt-6.1-sol",
        "unrelated_settings_preserved": True,
    }
    if args.apply:
        report["backup"] = str(install(args.target, originals, files))
        report["installed"] = True
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
