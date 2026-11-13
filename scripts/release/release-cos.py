import json
import os
import re
import sys
from pathlib import Path, PurePosixPath

from qcloud_cos import CosConfig, CosS3Client
from qcloud_cos.cos_exception import CosServiceError

BUCKET = "cherry-studio-1366585212"
PLATFORMS = ("windows", "mac", "linux")
EDITIONS = ("global", "cn")


def read_json(client, key, optional=False):
    try:
        response = client.get_object(Bucket=BUCKET, Key=key)
    except CosServiceError as error:
        if optional and error.get_error_code() == "NoSuchKey":
            return None
        raise
    with response["Body"].get_raw_stream() as body:
        return json.load(body)


def write_json(client, key, value):
    client.put_object(
        Bucket=BUCKET, Key=key, Body=json.dumps(value).encode(), ContentType="application/json"
    )


def stage_build(client, prefix, edition, platform):
    sources = json.loads(Path("release-upload.json").read_text(encoding="utf-8"))
    group = f"{edition}/{platform}"
    attempt = os.environ["GITHUB_RUN_ATTEMPT"]
    files = {}
    for relative, source in sources.items():
        key = f"{prefix}/attempt-{attempt}/{relative}"
        size = Path(source).stat().st_size
        print(f"Uploading {relative} to COS", flush=True)
        client.upload_file(Bucket=BUCKET, Key=key, LocalFilePath=source, PartSize=16)
        files[relative] = {"key": key, "size": size}
    write_json(client, f"{prefix}/{group}.json", files)


def assemble(client, base, prefix, platform):
    sha = os.environ["RELEASE_SHA"]
    selected = PLATFORMS if platform == "all" else (platform,)
    files = {}
    if platform != "all":
        baseline = read_json(client, f"{base}/baselines/{sha}.json", optional=True)
        if baseline is None:
            raise ValueError("No complete COS inventory for this commit. Run an all-platform build.")
        files = {
            relative: entry for relative, entry in baseline["files"].items()
            if relative.split("/")[1] != platform and not (
                platform == "linux" and relative.startswith("common/")
            )
        }
    for edition in EDITIONS:
        for target in selected:
            files.update(read_json(client, f"{prefix}/{edition}/{target}.json"))
    download_assets(client, files, Path("github-release-artifacts"), editions=("global",))
    body = Path("release_body.txt").read_text(encoding="utf-8")
    inventory = {"sha": sha, "platform": platform, "files": files, "body": body}
    Path("cos-release.json").write_text(json.dumps(inventory), encoding="utf-8")


def download_asset(client, entry, destination):
    client.download_file(Bucket=BUCKET, Key=entry["key"], DestFilePath=str(destination))
    if destination.stat().st_size != entry["size"]:
        raise RuntimeError(f"Incomplete COS download: {destination.name}")


def download_assets(client, files, directory, editions):
    directory.mkdir(exist_ok=True)
    for relative, entry in files.items():
        if relative.split("/")[0] in (*editions, "common"):
            filename = PurePosixPath(relative).name
            print(f"Downloading {filename} from COS", flush=True)
            download_asset(client, entry, directory / filename)


def summarize(client, prefix, tag):
    version = tag[1:]
    installer = re.compile(
        rf"Cherry-Studio-CN-{re.escape(version)}-(win|mac|linux)-(x64|arm64)"
        r"(?:-setup\.exe|\.dmg|\.AppImage)"
    )
    labels = {"win": "Windows", "mac": "macOS", "linux": "Linux"}
    lines = ["## CN installer downloads", "", "Download links expire after 24 hours.", ""]
    rows = []
    for platform in PLATFORMS:
        files = read_json(client, f"{prefix}/cn/{platform}.json", optional=True) or {}
        for relative, entry in sorted(files.items()):
            match = installer.fullmatch(PurePosixPath(relative).name)
            if not match:
                continue
            target, arch = match.groups()
            url = client.get_presigned_download_url(Bucket=BUCKET, Key=entry["key"], Expired=86400)
            rows.append(f"| {labels[target]} | {arch} | {version} | {entry['size'] / 1048576:.1f} MiB | [Download]({url}) |")
    if rows:
        lines.extend(["| Platform | Architecture | Version | Size | Download |",
                      "| --- | --- | --- | --- | --- |", *rows])
    else:
        lines.append("No CN installers are available. Check the build jobs for details.")
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
        summary.write("\n".join(lines) + "\n")


def main():
    command, *args = sys.argv[1:]
    tag = os.environ["TAG"]
    run_id = os.environ.get("SOURCE_RUN_ID") or os.environ["GITHUB_RUN_ID"]
    if not re.fullmatch(r"v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?", tag) or not run_id.isdecimal():
        raise ValueError("Invalid release tag or run ID")
    base = f"releases-sync/{tag}"
    prefix = f"{base}/{run_id}"
    domain = (
        f"{BUCKET}.cos.ap-shanghai.myqcloud.com"
        if command == "upload" and args[1:] == ["windows"]
        else f"{BUCKET}.cos.accelerate.myqcloud.com"
    )
    client = CosS3Client(CosConfig(
        Region="ap-shanghai", Domain=domain,
        SecretId=os.environ["COS_SECRET_ID"], SecretKey=os.environ["COS_SECRET_KEY"],
    ))
    if command == "upload":
        stage_build(client, prefix, *args)
    elif command == "assemble":
        assemble(client, base, prefix, *args)
    elif command == "begin-draft":
        write_json(client, f"{base}/draft.json", {"runId": None})
    elif command == "record":
        inventory = json.loads(Path("cos-release.json").read_text(encoding="utf-8"))
        write_json(client, f"{prefix}/release.json", inventory)
        write_json(client, f"{base}/baselines/{inventory['sha']}.json", inventory)
        write_json(client, f"{base}/draft.json", {"runId": run_id})
    elif command == "check-draft":
        current = read_json(client, f"{base}/draft.json")
        if current["runId"] != run_id:
            raise ValueError("The draft was updated by a different build run")
    elif command == "summary":
        summarize(client, prefix, tag)
    elif command == "prepare-sync":
        inventory = read_json(client, f"{prefix}/release.json")
        if inventory["platform"] != "all":
            raise ValueError("GitCode sync requires a complete all-platform release run")
        Path("release_body.txt").write_text(inventory["body"], encoding="utf-8")
        Path("cos-release.json").write_text(json.dumps(inventory), encoding="utf-8")
        Path("release-assets.txt").write_text("\n".join(sorted(inventory["files"])) + "\n", encoding="utf-8")
    elif command == "get-asset":
        inventory = json.loads(Path("cos-release.json").read_text(encoding="utf-8"))
        relative, target = args
        download_asset(client, inventory["files"][relative], Path(target))
    else:
        raise ValueError(f"Unknown release storage command: {command}")


if __name__ == "__main__":
    main()
