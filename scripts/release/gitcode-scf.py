import base64
import io
import json
import os
import sys
import time
import zipfile
from pathlib import Path

from tencentcloud.common import credential
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.scf.v20180416 import models, scf_client

FUNCTION = {"FunctionName": "cherry-release-sync", "Namespace": "default"}
REGION = "ap-shanghai"
TIMEOUT = 300


def client():
    profile = ClientProfile(httpProfile=HttpProfile(reqTimeout=930))
    credentials = credential.Credential(
        os.environ["TENCENT_SECRET_ID"], os.environ["TENCENT_SECRET_KEY"],
        os.environ.get("TENCENT_SESSION_TOKEN"),
    )
    return scf_client.ScfClient(credentials, REGION, profile)


def request(model, **values):
    data = model()
    data.from_json_string(json.dumps({**FUNCTION, **values}))
    return data


def deploy(scf, dependencies):
    function = scf.GetFunction(request(models.GetFunctionRequest))
    if function.Type != "Event" or function.Runtime not in ("Python3.9", "Python3.10"):
        raise RuntimeError("Expected an SCF event function running Python 3.9 or 3.10")
    if not function.Role:
        raise RuntimeError("Bind the COS read-only runtime role to the SCF function")
    if function.Timeout < TIMEOUT:
        raise RuntimeError(f"Set the SCF function timeout to at least {TIMEOUT} seconds")

    source = Path(__file__).parent
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        bundle.write(source / "gitcode-scf-handler.py", "index.py")
        bundle.write(source / "release-cos.py", "release-cos.py")
        for file in sorted(dependencies.rglob("*")):
            if file.is_file() and "__pycache__" not in file.parts:
                bundle.write(file, file.relative_to(dependencies))
    payload = base64.b64encode(archive.getvalue()).decode("ascii")
    scf.UpdateFunctionCode(request(
        models.UpdateFunctionCodeRequest, Handler="index.main_handler",
        CodeSource="ZipFile", ZipFile=payload,
    ))
    for _ in range(30):
        function = scf.GetFunction(request(models.GetFunctionRequest))
        if function.Status == "Active":
            print(f"Deployed {REGION}/default/cherry-release-sync")
            return
        if function.Status in ("CreateFailed", "UpdateFailed"):
            break
        time.sleep(2)
    raise RuntimeError(f"SCF code deployment did not become active ({function.Status})")


def upload(scf, relative):
    event = {
        "tag": os.environ["TAG"], "run_id": os.environ["SOURCE_RUN_ID"],
        "asset": relative, "upload": json.load(sys.stdin),
    }
    response = scf.InvokeFunction(request(
        models.InvokeFunctionRequest,
        Event=json.dumps(event, ensure_ascii=True),
    ))
    result = response.Result
    if not result or (result.ErrMsg or "").strip():
        raise RuntimeError(f"SCF transfer failed for {relative} (request {response.RequestId})")
    payload = json.loads(result.RetMsg or "{}")
    inventory = json.loads(Path("cos-release.json").read_text(encoding="utf-8"))
    if payload != {"asset": relative, "size": inventory["files"][relative]["size"]}:
        raise RuntimeError(f"SCF did not confirm the expected upload for {relative}")
    print(f"SCF uploaded {relative} ({payload['size']:,} bytes)")


if __name__ == "__main__":
    try:
        command, value = sys.argv[1:]
        scf = client()
        if command == "deploy":
            deploy(scf, Path(value))
        elif command == "upload":
            upload(scf, value)
        else:
            raise ValueError("Unknown SCF command")
    except TencentCloudSDKException as error:
        raise SystemExit(f"SCF API failed: {error.get_code()} (request {error.get_request_id()})") from None
    except (RuntimeError, KeyError, ValueError) as error:
        raise SystemExit(str(error) if isinstance(error, RuntimeError) else "Invalid or missing SCF configuration") from None
