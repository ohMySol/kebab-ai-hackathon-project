"""Endpoint entrypoint: overlay app/ and web/ from a pinned GitHub commit onto the image, then start Gauge.

Lets a running image pick up code changes without a Docker rebuild. Injected with
--inject-file deploy/start-from-github.py:/app/start-from-github.py and started with
--container-command python --args /app/start-from-github.py. GAUGE_COMMIT pins the commit.
If the download fails, the code already in the image is started unchanged.
"""
import io
import os
import sys
import tarfile
import urllib.request

REPO = os.getenv("GAUGE_REPO", "ohMySol/kebab-ai-hackathon-project")
COMMIT = os.getenv("GAUGE_COMMIT", "f620c5d44903ac247c71543584d2a32b01ebb8c5")
DEST = os.getenv("GAUGE_DEST", "/app")


def overlay():
    url = f"https://codeload.github.com/{REPO}/tar.gz/{COMMIT}"
    data = urllib.request.urlopen(url, timeout=60).read()
    count = 0
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        for member in archive.getmembers():
            parts = member.name.split("/", 1)
            if len(parts) == 2 and parts[1].split("/")[0] in ("app", "web") and member.isfile():
                member.name = parts[1]
                archive.extract(member, DEST, filter="data")
                count += 1
    print(f"gauge: overlaid {count} files from {REPO}@{COMMIT[:7]}", flush=True)


try:
    overlay()
except Exception as exc:  # start the image's own code rather than not at all
    print(f"gauge: overlay failed ({exc.__class__.__name__}: {exc}); starting the image's code", file=sys.stderr, flush=True)

if os.getenv("GAUGE_DRY_RUN"):
    sys.exit(0)
os.chdir(DEST)
os.execvp(sys.executable, [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0",
                           "--port", os.getenv("PORT", "8000"), "--workers", "1",
                           "--proxy-headers", "--forwarded-allow-ips=*"])
