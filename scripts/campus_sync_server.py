#!/usr/bin/env python3
"""校内即时真相源：日程 JSON + OTA。GitHub 只作改动备份。换 CLab 只改客户端里的根地址。

  H2_USER=... H2_PASS=... python scripts/campus_sync_server.py --data-dir ~/h2-data --port 8765

GET/PUT /schedule.json 要 Basic 账密或 Bearer。OTA GET 公开（方便手机拉包）。
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import itertools
import json
import os
import shutil
import ssl
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

# 旧版本备份保留上限（超出按时间戳删最旧的）。可用 H2_BACKUP_KEEP 覆盖（测试用）。
BACKUP_KEEP = int(os.environ.get("H2_BACKUP_KEEP", "") or "200")
_backup_seq = itertools.count(1)


def sha_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _eq(a: str, b: str) -> bool:
    if not a or not b or len(a) != len(b):
        return False
    return hmac.compare_digest(a, b)


def atomic_write(path: Path, data: bytes) -> None:
    """写临时文件 → flush + fsync → os.replace，崩溃不留半个文件。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".part")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def prune_backups(backups_dir: Path, stem: str, keep: int = BACKUP_KEEP) -> None:
    if not backups_dir.is_dir():
        return
    files = sorted(
        p for p in backups_dir.iterdir() if p.name.startswith(stem + ".") and p.name.endswith(".bak")
    )
    if len(files) <= keep:
        return
    for old in files[: len(files) - keep]:
        try:
            old.unlink()
        except OSError:
            pass


class Handler(BaseHTTPRequestHandler):
    data_dir: Path
    token: str
    user: str
    password: str
    web_root: Path | None
    # 读 sha → 比较 → 写 的临界区锁（ThreadingHTTPServer 多线程共享）
    _schedule_lock = threading.Lock()

    def log_message(self, fmt: str, *args) -> None:
        print("[%s] " % self.log_date_time_string() + (fmt % args))

    def cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, If-Match")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, PUT, OPTIONS")
        self.send_header("Access-Control-Expose-Headers", "ETag, X-H2-Sha")

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.cors()
        self.end_headers()

    def _path(self) -> str:
        return urlparse(self.path).path

    def _file(self, rel: str) -> Path:
        return (self.data_dir / rel).resolve()

    def _send_bytes(self, code: int, body: bytes, ctype: str, etag: str | None = None) -> None:
        self.send_response(code)
        self.cors()
        if code == 401:
            self.send_header("WWW-Authenticate", 'Basic realm="h2-campus"')
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        if etag:
            self.send_header("ETag", f'"{etag}"')
            self.send_header("X-H2-Sha", etag)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _auth_ok(self) -> bool:
        got = self.headers.get("Authorization", "")
        if self.token and _eq(got, f"Bearer {self.token}"):
            return True
        if self.password and _eq(got, f"Bearer {self.password}"):
            return True
        if got.lower().startswith("basic "):
            try:
                raw = base64.b64decode(got.split(None, 1)[1]).decode("utf-8")
            except Exception:
                return False
            u, _, p = raw.partition(":")
            return _eq(u, self.user) and _eq(p, self.password)
        return False

    def _need_schedule_auth(self) -> bool:
        return bool(self.token or self.password)

    def _read_file(self, rel: str, ctype: str) -> None:
        p = self._file(rel)
        if not p.is_file():
            self._send_bytes(404, b"not found\n", "text/plain; charset=utf-8")
            return
        data = p.read_bytes()
        self._send_bytes(200, data, ctype, sha_of(data))

    def _ctype(self, p: Path) -> str:
        if p.suffix in {".html", ""}:
            return "text/html; charset=utf-8"
        if p.suffix == ".json":
            return "application/json; charset=utf-8"
        if p.suffix == ".js":
            return "text/javascript; charset=utf-8"
        if p.suffix == ".css":
            return "text/css; charset=utf-8"
        if p.suffix == ".svg":
            return "image/svg+xml"
        if p.suffix in {".png", ".jpg", ".jpeg", ".webp"}:
            return f"image/{p.suffix.lstrip('.').replace('jpg', 'jpeg')}"
        return "application/octet-stream"

    def _web_file(self, rel: str) -> Path | None:
        root = (self.data_dir / "web").resolve()
        cand = (root / rel).resolve()
        if str(cand).startswith(str(root) + os.sep) or cand == root:
            if cand.is_file():
                return cand
        return None

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_GET(self) -> None:
        path = self._path()
        if path in ("/health", "/health/"):
            body = json.dumps({"ok": True, "role": "sot"}).encode("utf-8")
            self._send_bytes(200, body, "application/json; charset=utf-8")
            return
        if path in ("/", "/index.html", "/index.html/"):
            web_index = self._file("web/index.html")
            if web_index.is_file():
                data = web_index.read_bytes()
                self._send_bytes(200, data, "text/html; charset=utf-8", sha_of(data))
                return
            self._read_file("ota/app.html", "text/html; charset=utf-8")
            return
        if path in ("/schedule.json", "/schedule.json/"):
            if self._need_schedule_auth() and not self._auth_ok():
                self._send_bytes(401, b"unauthorized\n", "text/plain; charset=utf-8")
                return
            self._read_file("schedule.json", "application/json; charset=utf-8")
            return
        if path in ("/ota/manifest.json", "/ota/manifest.json/"):
            self._read_file("ota/manifest.json", "application/json; charset=utf-8")
            return
        if path in ("/ota/app.html", "/ota/app.html/"):
            self._read_file("ota/app.html", "text/html; charset=utf-8")
            return
        if path.startswith("/assets/") or path in ("/favicon.svg", "/favicon.svg/"):
            rel = path.lstrip("/")
            found = self._web_file(rel)
            if found:
                self._send_bytes(200, found.read_bytes(), self._ctype(found), sha_of(found.read_bytes()))
                return
        if self.web_root:
            rel = path.lstrip("/") or "index.html"
            cand = (self.web_root / rel).resolve()
            if str(cand).startswith(str(self.web_root.resolve())) and cand.is_file():
                self._send_bytes(200, cand.read_bytes(), self._ctype(cand))
                return
        self._send_bytes(404, b"not found\n", "text/plain; charset=utf-8")

    def do_PUT(self) -> None:
        path = self._path()
        ota_map = {
            "/ota/manifest.json": "ota/manifest.json",
            "/ota/app.html": "ota/app.html",
        }
        if path in ota_map or path.startswith("/web/"):
            if self._need_schedule_auth() and not self._auth_ok():
                self._send_bytes(401, b"unauthorized\n", "text/plain; charset=utf-8")
                return
            n = int(self.headers.get("Content-Length") or "0")
            body = self.rfile.read(n)
            if path.startswith("/web/"):
                rel = path[len("/web/") :]
                if ".." in rel.split("/"):
                    self._send_bytes(400, b"bad path\n", "text/plain; charset=utf-8")
                    return
                dest = self._file("web/" + rel)
            else:
                dest = self._file(ota_map[path])
            atomic_write(dest, body)
            etag = sha_of(body)
            self._send_bytes(200, json.dumps({"sha": etag}).encode("utf-8"), "application/json; charset=utf-8", etag)
            return
        if path not in ("/schedule.json", "/schedule.json/"):
            self._send_bytes(405, b"only PUT /schedule.json\n", "text/plain; charset=utf-8")
            return
        if self._need_schedule_auth() and not self._auth_ok():
            self._send_bytes(401, b"unauthorized\n", "text/plain; charset=utf-8")
            return
        if not self.token and not self.password:
            self._send_bytes(503, b"server token unset\n", "text/plain; charset=utf-8")
            return
        n = int(self.headers.get("Content-Length") or "0")
        body = self.rfile.read(n)
        try:
            json.loads(body.decode("utf-8"))
        except Exception:
            self._send_bytes(400, b"invalid json\n", "text/plain; charset=utf-8")
            return
        # 乐观锁：PUT 必须带 If-Match，缺失即拒绝（428），不匹配即 409。
        # 不再放行 sig: 前缀——那会让客户端拿到「无 sha」时盲盖服务端。
        # 首次创建用 If-Match: *（或空 sha）；已有文件必须带真实 sha。
        match = (self.headers.get("If-Match") or "").strip().strip('"')
        if not match:
            self._send_bytes(428, b"If-Match required\n", "text/plain; charset=utf-8")
            return
        dest = self._file("schedule.json")
        dest.parent.mkdir(parents=True, exist_ok=True)
        # 读 sha → 比较 → 备份 → 原子写 全在锁内，两个并发 PUT 只有一个能成功
        with Handler._schedule_lock:
            exists = dest.is_file()
            current = sha_of(dest.read_bytes()) if exists else ""
            wildcard = match == "*"
            if wildcard:
                if exists:
                    conflict = True
                else:
                    conflict = False
            else:
                conflict = match != current
            if conflict:
                self._send_bytes(409, b"conflict\n", "text/plain; charset=utf-8")
                return
            if exists:
                backups = dest.parent / "backups"
                backups.mkdir(parents=True, exist_ok=True)
                stamp = time.strftime("%Y%m%dT%H%M%S", time.gmtime())
                rev = next(_backup_seq)
                shutil.copyfile(dest, backups / f"schedule.{stamp}.{rev:05d}.{current[:12]}.bak")
                prune_backups(backups, "schedule")
            atomic_write(dest, body)
        etag = sha_of(body)
        self._send_bytes(200, json.dumps({"sha": etag}).encode("utf-8"), "application/json; charset=utf-8", etag)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--data-dir", default="campus-data")
    ap.add_argument("--web-root", default="", help="可选：同时托管网页目录")
    ap.add_argument("--tls-cert", default="")
    ap.add_argument("--tls-key", default="")
    args = ap.parse_args()
    token = os.environ.get("H2_WRITE_TOKEN", "").strip()
    user = os.environ.get("H2_USER", "").strip()
    password = os.environ.get("H2_PASS", "").strip()
    data = Path(args.data_dir)
    data.mkdir(parents=True, exist_ok=True)
    (data / "ota").mkdir(exist_ok=True)
    Handler.data_dir = data
    Handler.token = token
    Handler.user = user
    Handler.password = password
    Handler.web_root = Path(args.web_root).resolve() if args.web_root else None
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    if args.tls_cert and args.tls_key:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(args.tls_cert, args.tls_key)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    print(
        f"h2 campus sync on {args.host}:{args.port} data={data} "
        f"token_set={bool(token)} user_set={bool(user)}"
    )
    httpd.serve_forever()


if __name__ == "__main__":
    main()
