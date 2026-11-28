#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""release/m1 单写者写锁（WRITER）。

约定（2026-11-27 定）：
  * <root>/WRITER 存在即视为该树被占；内容为 JSON：
      {"session","profile","pid","started_at","files":[...],"brief_sha"}
  * 发现 WRITER 存在且不是自己 → rc=9 DIR_BUSY，不写、不覆盖，打印持有者。
  * 释放 = 删除 WRITER（正常退出与中止都删）。
  * 陈旧判定（2026-11-27 修正，只判时间是不够的）：
      - pid 已不存在（os.kill → ESRCH）→ stale=true，立即可接管；
      - pid 存在但对应进程命令行不含本锁根目录名（pid 复用）→ stale=true，理由记 pid_reused；
      - pid 存在且命令行匹配 → 无论超时多久都不算 stale，只报 age_exceeded（禁止抢活着的写者）；
      - 老记录没有 pid 字段时退回「started_at 超 30 分钟」判旧。

用法：
  writer_lock.py status  --root .
  writer_lock.py acquire --root . --session S --profile P [--files a,b] [--brief-sha X]
  writer_lock.py release --root . --session S
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime

STALE_SECONDS = 30 * 60
RC_BUSY = 9
RC_STALE_TAKEOVER = 0
LOCK_NAME = "WRITER"
HISTORY_NAME = "WRITER.history.ndjson"
TOOL_REVIEW_STATUS = "pending"  # 本工具自身未经独立复核；过审后改成 reviewed（不改历史记录）


def _tool_sha():
    try:
        import hashlib
        with open(os.path.abspath(__file__), "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()
    except Exception:
        return None


def pid_alive(pid):
    """True=进程存在；False=不存在（ESRCH）；None=无 pid 字段或无法判定。"""
    if not isinstance(pid, int) or pid <= 0:
        return None
    try:
        os.kill(pid, 0)
    except OSError as exc:
        import errno
        if exc.errno == errno.ESRCH:
            return False
        if exc.errno == errno.EPERM:
            return True
        return None
    return True


def pid_command(pid):
    """取进程命令行（判 pid 复用用）。取不到返回 ''。"""
    try:
        import subprocess
        out = subprocess.run(["/bin/ps", "-p", str(pid), "-o", "command="],
                             capture_output=True, timeout=5)
        return out.stdout.decode("utf-8", "replace").strip()
    except Exception:
        return ""


def owner_running(root):
    """是否有活跃进程把本目录当工作目录（codex -C / 命令行含绝对路径）。返回 [pid,...]。"""
    import subprocess
    try:
        out = subprocess.run(["/bin/ps", "-Ao", "pid=,command="], capture_output=True, timeout=5)
    except Exception:
        return []
    want = os.path.abspath(root)
    hits = []
    me = os.getpid()
    for line in out.stdout.decode("utf-8", "replace").splitlines():
        pid, _, cmd = line.strip().partition(" ")
        try:
            ipid = int(pid)
        except ValueError:
            continue
        if ipid == me or want not in cmd:
            continue
        # 排除「调用本工具的那条命令」本身：它含 writer_lock.py 但不是持有者
        if "writer_lock.py" in cmd and "codex" not in cmd:
            continue
        hits.append(ipid)
    return hits


def stale_state(lock, root):
    """统一陈旧判定。返回 (stale, reason, age, alive)。

    pid 死 → 立即陈旧；pid 活且命令行含 root 名 → 不陈旧（哪怕超时）；
    pid 活但命令行不含 root 名 → 判 pid_reused（陈旧）。
    """
    age = age_seconds(lock)
    pid = lock.get("pid")
    alive = pid_alive(pid)
    if alive is False:
        # pid 字段可能是「取锁工具」的短命进程：只要还有进程以本目录为工作目录，就不算陈旧
        owners = owner_running(root)
        if owners:
            return False, "pid_dead_but_owner_running(%s)" % ",".join(str(x) for x in owners[:3]), age, False
        return True, "pid_dead", age, False
    if alive is None:
        return bool(age is not None and age > STALE_SECONDS), "age_only(no_pid)", age, None
    cmd = pid_command(pid)
    base = os.path.basename(os.path.abspath(root)) or ""
    if base and base not in cmd:
        # 命令行不含本目录名：可能是 pid 复用，也可能是正常的派发进程 → 只提示，不因此抢锁
        return False, "alive_cmd_mismatch(command=%s)" % cmd[:80], age, True
    return False, "alive", age, True


def _file_sha(path):
    import hashlib
    try:
        h = hashlib.sha256()
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()
    except OSError:
        return None


def _snapshot_files(root, files):
    return {f: _file_sha(os.path.join(root, f)) for f in (files or [])}


def verify_files(root, lock):
    """比对锁内记录的 file_sha 与磁盘现状；返回变化清单。"""
    base = lock.get("file_sha") or {}
    out = []
    for f, was in base.items():
        now = _file_sha(os.path.join(root, f))
        if was and now and was != now:
            out.append({"file": f, "at_acquire": was, "now": now})
    return out


def _now_iso():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _lock_path(root):
    return os.path.join(root, LOCK_NAME)


def read_lock(root):
    p = _lock_path(root)
    if not os.path.exists(p):
        return None
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as exc:  # 损坏的锁同样算被占，不能当作无锁
        return {"_corrupt": str(exc), "session": "?", "profile": "?", "pid": None, "started_at": None}
    return data


def age_seconds(lock):
    st = lock.get("started_at")
    if not st:
        return None
    try:
        t = datetime.fromisoformat(st)
    except Exception:
        return None
    return time.time() - t.timestamp()


def _append_history(root, record):
    with open(os.path.join(root, HISTORY_NAME), "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def cmd_status(root, as_json=False):
    lock = read_lock(root)
    if lock is None:
        out = {"locked": False}
    else:
        stale, reason, age, alive = stale_state(lock, root)
        touched = verify_files(root, lock)
        out = {
            "locked": True,
            "stale": stale,
            "stale_reason": reason,
            "pid_alive": alive,
            "age_exceeded": bool(age is not None and age > STALE_SECONDS),
            "age_seconds": None if age is None else int(age),
            "holder": lock,
            "FILE_TOUCHED_BY_OTHER": touched,
        }
    if as_json:
        print(json.dumps(out, ensure_ascii=False))
    elif not out["locked"]:
        print("FREE")
    else:
        print("BUSY stale=%s reason=%s pid_alive=%s age=%ss holder=%s/%s pid=%s started_at=%s files=%s" % (
            out["stale"], out["stale_reason"], out["pid_alive"], out["age_seconds"],
            lock.get("profile"), lock.get("session"),
            lock.get("pid"), lock.get("started_at"), lock.get("files")))
        if out["FILE_TOUCHED_BY_OTHER"]:
            print("FILE_TOUCHED_BY_OTHER: " + "; ".join(
                "%s %s->%s" % (d["file"], d["at_acquire"][:12], d["now"][:12])
                for d in out["FILE_TOUCHED_BY_OTHER"]))
    return 0


def cmd_acquire(root, session, profile, files, brief_sha):
    lock = read_lock(root)
    if lock is not None:
        same = lock.get("session") == session
        stale, stale_reason, age, _alive = stale_state(lock, root)
        if not same and not stale:
            sys.stderr.write(
                "DIR_BUSY: %s 被占用 holder.session=%s holder.profile=%s pid=%s started_at=%s files=%s\n"
                % (_lock_path(root), lock.get("session"), lock.get("profile"), lock.get("pid"),
                   lock.get("started_at"), lock.get("files")))
            return RC_BUSY
        if stale and not same:
            _append_history(root, {"event": "stale_takeover", "at": _now_iso(),
                                   "stale_reason": stale_reason, "age_seconds": None if age is None else int(age),
                                   "previous": lock, "by": {"session": session, "profile": profile}})
    payload = {
        "session": session,
        "profile": profile,
        "pid": os.getpid(),
        "started_at": _now_iso(),
        "files": files,
        "file_sha": _snapshot_files(root, files),
        "brief_sha": brief_sha,
        "tool_sha": _tool_sha(),
        "tool_review": TOOL_REVIEW_STATUS,
    }
    target = _lock_path(root)
    tmp = target + ".tmp.%d" % os.getpid()
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    os.replace(tmp, target)  # 原子落盘，禁 open(dst,'w').write(open(dst).read()) 式改写
    _append_history(root, {"event": "acquire", "at": _now_iso(), "holder": payload})
    print("ACQUIRED %s session=%s pid=%d files=%s" % (target, session, os.getpid(), files))
    return 0


def cmd_release(root, session):
    lock = read_lock(root)
    if lock is None:
        print("FREE (no WRITER)")
        return 0
    if lock.get("session") != session:
        sys.stderr.write("DIR_BUSY: WRITER 属于 %s，拒绝由 %s 释放\n" % (lock.get("session"), session))
        return RC_BUSY
    os.remove(_lock_path(root))
    _append_history(root, {"event": "release", "at": _now_iso(), "holder": lock})
    print("RELEASED %s" % _lock_path(root))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("status", "acquire", "release"):
        p = sub.add_parser(name)
        p.add_argument("--root", default=".")
        if name == "status":
            p.add_argument("--json", action="store_true")
        if name in ("acquire", "release"):
            p.add_argument("--session", required=True)
        if name == "acquire":
            p.add_argument("--profile", default="user-feedback")
            p.add_argument("--files", default="")
            p.add_argument("--brief-sha", default="")
    a = ap.parse_args(argv)
    if a.cmd == "status":
        return cmd_status(a.root, a.json)
    if a.cmd == "acquire":
        files = [x for x in a.files.split(",") if x]
        return cmd_acquire(a.root, a.session, a.profile, files, a.brief_sha)
    return cmd_release(a.root, a.session)


if __name__ == "__main__":
    sys.exit(main())
