import os
from pathlib import Path

from qcloud_cos import CosConfig, CosS3Client


def main():
    client = CosS3Client(
        CosConfig(
            Region="ap-shanghai",
            SecretId=os.environ["COS_SECRET_ID"],
            SecretKey=os.environ["COS_SECRET_KEY"],
        )
    )
    bucket = "cherry-studio-1366585212"
    prefix = f"releases-sync/{os.environ['TAG']}/{os.environ['GITHUB_RUN_ID']}"

    for file in [*sorted(Path("release-assets").iterdir()), Path("release_body.txt")]:
        print(f"Uploading {file.name} to COS", flush=True)
        client.upload_file(Bucket=bucket, Key=f"{prefix}/{file.name}", LocalFilePath=str(file), PartSize=16)


if __name__ == "__main__":
    main()
