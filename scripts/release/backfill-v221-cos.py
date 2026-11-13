import hashlib
import importlib
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from qcloud_cos import CosConfig, CosS3Client
from qcloud_cos.cos_exception import CosServiceError

REPO = "CherryHQ/cherry-studio"
TAG = "v2.2.1"
SHA = "caa5ee971b7075c9c3161583eb08c33149b2940d"
ARTIFACT_ID = 13954976737
ARCHIVE_SIZE = 8061122359
PREFIX = "releases-sync/v2.2.1/43229565814"
CHUNK = 8 * 1024 * 1024
release_cos = importlib.import_module("release-cos")
BUCKET = release_cos.BUCKET


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


class ArchiveSource:
    def __init__(self):
        self.lock = threading.Lock()
        self.location = None
        self.issued = 0

    def signed_url(self, refresh=None):
        with self.lock:
            if self.location and refresh != self.location and time.monotonic() - self.issued < 40:
                return self.location
            request = urllib.request.Request(
                f"https://api.github.com/repos/{REPO}/actions/artifacts/{ARTIFACT_ID}/zip",
                headers={"Authorization": "Bearer " + os.environ["GH_TOKEN"]},
            )
            try:
                urllib.request.build_opener(NoRedirect()).open(request, timeout=30).close()
            except urllib.error.HTTPError as error:
                if error.code != 302 or not error.headers.get("Location"):
                    raise RuntimeError(f"Artifact URL request returned HTTP {error.code}") from None
                self.location = error.headers["Location"]
                self.issued = time.monotonic()
                return self.location
            raise RuntimeError("Artifact URL request did not redirect")

    def read(self, start, count):
        end = start + count - 1
        refresh = None
        for attempt in range(4):
            url = self.signed_url(refresh)
            request = urllib.request.Request(url, headers={
                "Range": f"bytes={start}-{end}", "Accept-Encoding": "identity",
            })
            try:
                with urllib.request.urlopen(request, timeout=45) as response:
                    if response.status != 206 or response.headers["Content-Range"] != f"bytes {start}-{end}/{ARCHIVE_SIZE}":
                        raise ValueError("Artifact response did not match requested byte range")
                    data = response.read(count)
                    if len(data) != count:
                        raise OSError("Incomplete range response")
                    return data
            except urllib.error.HTTPError as error:
                if error.code in (401, 403):
                    refresh = url
            except (OSError, EOFError):
                pass
            time.sleep(2 ** attempt)
        raise RuntimeError(f"Could not read artifact bytes {start}-{end}")


class RangeReader(io.RawIOBase):
    def __init__(self, source):
        self.source = source
        self.pos = 0

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        self.pos = (0, self.pos, ARCHIVE_SIZE)[whence] + offset
        return self.pos

    def read(self, count=-1):
        count = min(count if count >= 0 else ARCHIVE_SIZE, ARCHIVE_SIZE - self.pos)
        if count <= 0:
            return b""
        if count > CHUNK:
            raise ValueError("Requested range exceeds per-read limit")
        data = self.source.read(self.pos, count)
        self.pos += count
        return data


def cos_client():
    return CosS3Client(CosConfig(
        Region="ap-shanghai", Domain=f"{BUCKET}.cos.accelerate.myqcloud.com",
        SecretId=os.environ["COS_SECRET_ID"], SecretKey=os.environ["COS_SECRET_KEY"],
    ))


def head(client, key):
    try:
        return client.head_object(Bucket=BUCKET, Key=key)
    except CosServiceError as error:
        if error.get_status_code() == 404 or error.get_error_code() in ("NoSuchKey", "NoSuchResource"):
            return {}
        raise


def release_info():
    result = subprocess.check_output(["gh", "api", f"repos/{REPO}/releases/tags/{TAG}"])
    info = json.loads(result)
    if info["draft"] or info["tag_name"] != TAG:
        raise RuntimeError("Expected a published v2.2.1 release")
    return info


def stage(source, item):
    relative, entry = item
    key = f"{PREFIX}/backfill/{relative}"
    client = cos_client()
    if isinstance(entry, zipfile.ZipInfo):
        size = entry.file_size
        fingerprint = f"zip-crc32-{entry.CRC:08x}"
    else:
        size = entry["size"]
        fingerprint = entry["digest"].replace(":", "-", 1)
    def verified():
        stored = {k.lower(): v for k, v in head(client, key).items()}
        return stored.get("content-length") == str(size) and stored.get("x-cos-meta-source-digest") == fingerprint

    if not verified():
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / Path(relative).name
            if isinstance(entry, zipfile.ZipInfo):
                with zipfile.ZipFile(RangeReader(source)) as archive:
                    with archive.open(entry.filename) as infile, target.open("wb") as outfile:
                        shutil.copyfileobj(infile, outfile, CHUNK)
            else:
                subprocess.run(["curl", "--silent", "--show-error", "--fail", "--location",
                                "--retry", "4", "--max-time", "600", "--output", str(target),
                                entry["browser_download_url"]], check=True)
                with target.open("rb") as infile:
                    digest = hashlib.file_digest(infile, "sha256").hexdigest()
                if fingerprint != f"sha256-{digest}":
                    raise RuntimeError(f"GitHub attachment digest mismatch: {relative}")
            if target.stat().st_size != size:
                raise RuntimeError(f"Incorrect extracted size: {relative}")
            client.upload_file(Bucket=BUCKET, Key=key, LocalFilePath=str(target),
                               PartSize=16, MAXThread=3, EnableMD5=True, Metadata={"x-cos-meta-source-digest": fingerprint})
        if not verified():
            raise RuntimeError(f"COS object verification failed: {relative}")
    print(f"Verified {relative} ({size:,} bytes)", flush=True)
    return relative, {"key": key, "size": size}


def main():
    source = ArchiveSource()
    info = release_info()
    with zipfile.ZipFile(RangeReader(source)) as archive:
        entries = archive.infolist()
    cn = [entry for entry in entries if re.fullmatch(r"cn/(linux|mac|windows)/[^/]+", entry.filename)]
    globals_by_name = {
        Path(entry.filename).name: entry.filename for entry in entries
        if re.fullmatch(r"global/(linux|mac|windows)/[^/]+|common/release-history.json", entry.filename)
    }
    assets = {asset["name"]: asset for asset in info["assets"]}
    if len(cn) != 22 or len(globals_by_name) != 23 or globals_by_name.keys() != assets.keys():
        raise RuntimeError("Source files differ from the expected v2.2.1 editions")
    if any(not re.fullmatch(r"sha256:[a-f0-9]{64}", asset.get("digest") or "") for asset in assets.values()):
        raise RuntimeError("Missing GitHub attachment checksum")
    items = [(globals_by_name[name], asset) for name, asset in assets.items()]
    items.extend((entry.filename, entry) for entry in cn)
    if len({relative for relative, _ in items}) != 45:
        raise RuntimeError("Duplicate release file")
    print("Migrating 22 Global files, 22 CN files, and shared release history", flush=True)
    with ThreadPoolExecutor(max_workers=5) as executor:
        files = dict(executor.map(lambda item: stage(source, item), items))
    inventory = {"sha": SHA, "platform": "all", "body": info["body"], "files": files}
    client = cos_client()
    key = f"{PREFIX}/release.json"
    release_cos.write_json(client, key, inventory)
    if release_cos.read_json(client, key) != inventory:
        raise RuntimeError("COS inventory read-back failed")
    print(f"Verified COS inventory: {key} ({len(files)} files)", flush=True)


if __name__ == "__main__":
    main()
