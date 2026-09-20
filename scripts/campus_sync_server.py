#!/usr/bin/env python3
"""校内同步预置：日程 JSON + OTA。不替代 Git，只给手机在打不开 GitHub 时用。

  H2_WRITE_TOKEN=... python3 scripts/campus_sync_server.py --data-dir ~/h2-data --port 8765

PUT /schedule.json 需要 Authorization: Bearer <token>
GET 公开。ETag 当 sha。CORS 全开。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import ssl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


def sha_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class Handler(BaseHTTPRequestHandler):
    data_dir: Path
    token: str
    web_root: Path | None

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
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        if etag:
            self.send_header("ETag", f'"{etag}"')
            self.send_header("X-H2-Sha", etag)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _read_file(self, rel: str, ctype: str) -> None:
        p = self._file(rel)
        if not p.is_file():
            self._send_bytes(404, b"not found\n", "text/plain; charset=utf-8")
            return
        data = p.read_bytes()
        self._send_bytes(200, data, ctype, sha_of(data))

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_GET(self) -> None:
        path = self._path()
        if path in ("/schedule.json", "/schedule.json/"):
            self._read_file("schedule.json", "application/json; charset=utf-8")
            return
        if path in ("/ota/manifest.json", "/ota/manifest.json/"):
            self._read_file("ota/manifest.json", "application/json; charset=utf-8")
            return
        if path in ("/ota/app.html", "/ota/app.html/"):
            self._read_file("ota/app.html", "text/html; charset=utf-8")
            return
        if self.web_root:
            rel = path.lstrip("/") or "index.html"
            cand = (self.web_root / rel).resolve()
            if str(cand).startswith(str(self.web_root.resolve())) and cand.is_file():
                ctype = "text/html; charset=utf-8" if cand.suffix in {".html", ""} else "application/octet-stream"
                if cand.suffix == ".json":
                    ctype = "application/json; charset=utf-8"
                elif cand.suffix == ".js":
                    ctype = "text/javascript; charset=utf-8"
                elif cand.suffix == ".css":
                    ctype = "text/css; charset=utf-8"
                self._send_bytes(200, cand.read_bytes(), ctype)
                return
        self._send_bytes(404, b"not found\n", "text/plain; charset=utf-8")

    def _auth_ok(self) -> bool:
        got = self.headers.get("Authorization", "")
        if got == f"Bearer {self.token}":
            return True
        return False

    def do_PUT(self) -> None:
        path = self._path()
        if path not in ("/schedule.json", "/schedule.json/"):
            self._send_bytes(405, b"only PUT /schedule.json\n", "text/plain; charset=utf-8")
            return
        if not self.token:
            self._send_bytes(503, b"server token unset\n", "text/plain; charset=utf-8")
            return
        if not self._auth_ok():
            self._send_bytes(401, b"unauthorized\n", "text/plain; charset=utf-8")
            return
        n = int(self.headers.get("Content-Length") or "0")
        body = self.rfile.read(n)
        try:
            json.loads(body.decode("utf-8"))
        except Exception:
            self._send_bytes(400, b"invalid json\n", "text/plain; charset=utf-8")
            return
        dest = self._file("schedule.json")
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.is_file():
            current = sha_of(dest.read_bytes())
            match = (self.headers.get("If-Match") or "").strip().strip('"')
            if match and match != current and not match.startswith("sig:"):
                self._send_bytes(409, b"conflict\n", "text/plain; charset=utf-8")
                return
        dest.write_bytes(body)
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
    data = Path(args.data_dir)
    data.mkdir(parents=True, exist_ok=True)
    (data / "ota").mkdir(exist_ok=True)
    Handler.data_dir = data
    Handler.token = token
    Handler.web_root = Path(args.web_root).resolve() if args.web_root else None
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    if args.tls_cert and args.tls_key:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(args.tls_cert, args.tls_key)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    print(f"h2 campus sync on {args.host}:{args.port} data={data} token_set={bool(token)}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
