import http.client
import importlib
import os
import re
from pathlib import PurePosixPath
from urllib.parse import urlsplit

from qcloud_cos import CosConfig, CosS3Client

release_cos = importlib.import_module("release-cos")
REGION = "ap-shanghai"


def main_handler(event, context):
    tag, run_id, relative = (event[key] for key in ("tag", "run_id", "asset"))
    if not re.fullmatch(r"v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?", tag) or not re.fullmatch(r"[0-9]+", run_id):
        raise ValueError("Invalid release tag or run ID")

    upload = event["upload"]
    url = urlsplit(upload["url"])
    if (url.scheme != "https" or url.username or url.password or url.fragment
            or url.port not in (None, 443) or not url.hostname
            or not re.fullmatch(r"[a-z0-9.-]*obs\.[a-z0-9-]+\.myhuaweicloud\.(?:com|cn)", url.hostname)):
        raise ValueError("Unexpected GitCode attachment upload endpoint")

    headers = upload["headers"]
    if any(name.lower() in {"authorization", "connection", "content-length", "expect", "host",
                            "transfer-encoding"} for name in headers):
        raise ValueError("Unexpected GitCode attachment upload headers")

    client = CosS3Client(CosConfig(
        Region=REGION,
        SecretId=os.environ["TENCENTCLOUD_SECRETID"],
        SecretKey=os.environ["TENCENTCLOUD_SECRETKEY"],
        Token=os.environ["TENCENTCLOUD_SESSIONTOKEN"],
        Timeout=60,
    ))
    prefix = f"releases-sync/{tag}/{run_id}"
    inventory = release_cos.read_json(client, f"{prefix}/release.json")
    if inventory["platform"] != "all" or relative not in inventory["files"]:
        raise ValueError("Attachment is absent from the complete release inventory")
    entry = inventory["files"][relative]
    key = entry["key"]
    if (not key.startswith(f"releases-sync/{tag}/") or ".." in PurePosixPath(key).parts
            or not key.endswith(f"/{relative}")):
        raise ValueError("Unexpected COS attachment key")

    response = client.get_object(Bucket=release_cos.BUCKET, Key=key)
    size = entry["size"]
    with response["Body"].get_raw_stream() as source:
        length = next((value for name, value in response.items() if name.lower() == "content-length"), None)
        if length is None or int(length) != size:
            raise ValueError("COS attachment size differs from the release inventory")
        connection = http.client.HTTPSConnection(url.hostname, timeout=60)
        try:
            target = url.path or "/"
            if url.query:
                target += f"?{url.query}"
            connection.request("PUT", target, body=source, headers={**headers, "Content-Length": str(size)})
            with connection.getresponse() as result:
                if not 200 <= result.status < 300:
                    raise RuntimeError(f"GitCode attachment PUT returned HTTP {result.status}")
        except (OSError, http.client.HTTPException):
            raise RuntimeError("GitCode attachment upload connection failed") from None
        finally:
            connection.close()
    return {"asset": relative, "size": size}
