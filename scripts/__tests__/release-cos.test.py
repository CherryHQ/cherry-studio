import importlib.util
import io
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch


sdk = types.ModuleType("qcloud_cos")
sdk.CosConfig = sdk.CosS3Client = object
exceptions = types.ModuleType("qcloud_cos.cos_exception")


class MissingObject(Exception):
    def get_error_code(self):
        return "NoSuchKey"


exceptions.CosServiceError = MissingObject
spec = importlib.util.spec_from_file_location(
    "release_cos", Path(__file__).resolve().parents[1] / "release" / "release-cos.py"
)
release = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {"qcloud_cos": sdk, "qcloud_cos.cos_exception": exceptions}):
    spec.loader.exec_module(release)


class Store:
    def __init__(self):
        self.objects = {}
        self.fail_key = None

    def upload_file(self, *, Key, LocalFilePath, **kwargs):
        if Key == self.fail_key:
            raise RuntimeError("interrupted upload")
        self.objects[Key] = Path(LocalFilePath).read_bytes()

    def put_object(self, *, Key, Body, **kwargs):
        self.objects[Key] = Body

    def get_object(self, *, Key, **kwargs):
        if Key not in self.objects:
            raise MissingObject(Key)
        return {"Body": types.SimpleNamespace(get_raw_stream=lambda: io.BytesIO(self.objects[Key]))}

    def download_file(self, *, Key, DestFilePath, **kwargs):
        Path(DestFilePath).write_bytes(self.objects[Key])


class ReleaseCosTests(unittest.TestCase):
    def setUp(self):
        self.store = Store()
        self.base = "releases-sync/v2.2.1"
        self.prefix = self.base + "/200"
        directory = self.enterContext(tempfile.TemporaryDirectory())
        original = Path.cwd()
        self.addCleanup(os.chdir, original)
        os.chdir(directory)
        self.enterContext(patch.dict(os.environ, {"GITHUB_RUN_ATTEMPT": "1", "GITHUB_RUN_ID": "200", "RELEASE_SHA": "a" * 40, "TAG": "v2.2.1"}))

    def test_failed_upload_does_not_publish_partial_inventory(self):
        Path("one").write_bytes(b"first")
        Path("two").write_bytes(b"second")
        files = {"global/windows/one.exe": "one", "global/windows/two.exe": "two"}
        Path("release-upload.json").write_text(json.dumps(files), encoding="utf-8")
        self.store.fail_key = self.prefix + "/attempt-1/global/windows/two.exe"
        with self.assertRaisesRegex(RuntimeError, "interrupted upload"):
            release.stage_build(self.store, self.prefix, "global", "windows")
        self.assertNotIn(self.prefix + "/global/windows.json", self.store.objects)

        self.store.fail_key = None
        os.environ["GITHUB_RUN_ATTEMPT"] = "2"
        release.stage_build(self.store, self.prefix, "global", "windows")
        inventory = json.loads(self.store.objects[self.prefix + "/global/windows.json"])
        self.assertEqual(set(inventory), set(files))
        self.assertEqual(self.store.objects[inventory["global/windows/one.exe"]["key"]], b"first")
        self.assertEqual(self.store.objects[inventory["global/windows/two.exe"]["key"]], b"second")

    def test_upload_uses_shanghai_only_for_windows(self):
        for edition in release.EDITIONS:
            for platform in release.PLATFORMS:
                with (
                    self.subTest(edition=edition, platform=platform),
                    patch.object(sys, "argv", ["release-cos.py", "upload", edition, platform]),
                    patch.dict(os.environ, {"TAG": "v2.2.1", "COS_SECRET_ID": "id", "COS_SECRET_KEY": "key"}),
                    patch.object(release, "CosConfig") as config,
                    patch.object(release, "CosS3Client", return_value=self.store),
                    patch.object(release, "stage_build") as stage,
                ):
                    release.main()
                    endpoint = "ap-shanghai" if platform == "windows" else "accelerate"
                    self.assertEqual(config.call_args.kwargs["Domain"], f"{release.BUCKET}.cos.{endpoint}.myqcloud.com")
                    stage.assert_called_once_with(self.store, self.prefix, edition, platform)

    def test_partial_build_reuses_only_other_platforms_and_downloads_global(self):
        baseline = {}
        for edition in release.EDITIONS:
            for platform in release.PLATFORMS:
                relative = f"{edition}/{platform}/{edition}-{platform}.bin"
                key = f"{self.base}/100/{relative}"
                baseline[relative] = {"key": key, "size": 3}
                self.store.objects[key] = b"old"
            relative = f"{edition}/windows/{edition}-windows.bin"
            key = f"{self.prefix}/{relative}"
            self.store.objects[key] = b"new"
            release.write_json(self.store, f"{self.prefix}/{edition}/windows.json", {relative: {"key": key, "size": 3}})

        release.write_json(self.store, f"{self.base}/baselines/{os.environ['RELEASE_SHA']}.json", {"files": baseline})
        Path("release_body.txt").write_text("release notes", encoding="utf-8")
        release.assemble(self.store, self.base, self.prefix, "windows")
        inventory = json.loads(Path("cos-release.json").read_text(encoding="utf-8"))
        self.assertEqual(set(inventory["files"]), set(baseline))
        self.assertEqual(inventory["files"]["cn/mac/cn-mac.bin"], baseline["cn/mac/cn-mac.bin"])
        self.assertTrue(inventory["files"]["cn/windows/cn-windows.bin"]["key"].startswith(self.prefix))
        draft = Path("github-release-artifacts")
        self.assertEqual({file.name for file in draft.iterdir()}, {"global-windows.bin", "global-mac.bin", "global-linux.bin"})
        self.assertEqual((draft / "global-windows.bin").read_bytes(), b"new")

    def populate_targets(self):
        for edition in release.EDITIONS:
            product = "Cherry-Studio" if edition == "global" else "Cherry-Studio-CN"
            channel = "latest" if edition == "global" else "latest-cn"
            for platform in release.PLATFORMS:
                for group in release.inventory_groups(platform):
                    arch = group.split("/")[-1]
                    name = f"{product}-2.2.1-{platform}-{arch}.bin"
                    content = arch.encode()
                    if platform == "mac":
                        name = f"{product}-2.2.1-mac-{arch}.zip"
                    relative = f"{edition}/{platform}/{name}"
                    key = f"{self.prefix}/attempt-1/{relative}"
                    self.store.objects[key] = content
                    files = {relative: {"key": key, "size": len(content)}}
                    if platform == "mac":
                        manifest = f"{edition}/mac/{channel}-mac-{arch}.yml"
                        manifest_key = f"{self.prefix}/attempt-1/{manifest}"
                        body = json.dumps({"version": "2.2.1", "files": [{"url": name, "sha512": arch, "size": len(content)}], "releaseNotes": "notes"}).encode()
                        self.store.objects[manifest_key] = body
                        files[manifest] = {"key": manifest_key, "size": len(body)}
                    release.write_json(self.store, f"{self.prefix}/{edition}/{group}.json", files)
        Path("release_body.txt").write_text("notes", encoding="utf-8")

    def test_all_targets_merge_manifests_without_downloading_cn_installers(self):
        self.populate_targets()
        release.assemble(self.store, self.base, self.prefix, "all")
        inventory = json.loads(Path("cos-release.json").read_text(encoding="utf-8"))
        for edition in release.EDITIONS:
            channel = "latest" if edition == "global" else "latest-cn"
            canonical = f"{edition}/mac/{channel}-mac.yml"
            self.assertIn(canonical, inventory["files"])
            self.assertNotIn(f"{edition}/mac/{channel}-mac-x64.yml", inventory["files"])
            self.assertNotIn(f"{edition}/mac/{channel}-mac-arm64.yml", inventory["files"])
            body = self.store.objects[inventory["files"][canonical]["key"]].decode()
            self.assertIn("mac-x64.zip", body)
            self.assertIn("mac-arm64.zip", body)
            self.assertIn("releaseNotes: notes", body)
        downloads = list(Path("github-release-artifacts").iterdir())
        self.assertTrue(any(file.name == "latest-mac.yml" for file in downloads))
        self.assertFalse(any("CN" in file.name for file in downloads))

    def test_missing_architecture_cannot_create_a_complete_inventory(self):
        self.populate_targets()
        del self.store.objects[f"{self.prefix}/cn/linux/arm64.json"]
        with self.assertRaises(MissingObject):
            release.assemble(self.store, self.base, self.prefix, "all")
        self.assertFalse(Path("cos-release.json").exists())

    def test_colliding_target_files_fail_instead_of_overwriting(self):
        self.populate_targets()
        first = release.read_json(self.store, f"{self.prefix}/global/linux/x64.json")
        release.write_json(self.store, f"{self.prefix}/global/linux/arm64.json", first)
        with self.assertRaisesRegex(ValueError, "Conflicting release files"):
            release.assemble(self.store, self.base, self.prefix, "all")
        self.assertFalse(Path("cos-release.json").exists())

    def test_architecture_uploads_do_not_replace_each_others_inventories(self):
        for arch in ("x64", "arm64"):
            name = f"{arch}.bin"
            Path(name).write_bytes(arch.encode())
            Path("release-upload.json").write_text(json.dumps({f"cn/mac/{name}": name}), encoding="utf-8")
            release.stage_build(self.store, self.prefix, "cn", "mac", arch)
        for arch in ("x64", "arm64"):
            inventory = release.read_json(self.store, f"{self.prefix}/cn/mac/{arch}.json")
            self.assertEqual(list(inventory), [f"cn/mac/{arch}.bin"])


if __name__ == "__main__":
    unittest.main()
