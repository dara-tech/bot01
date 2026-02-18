#!/usr/bin/env python3
"""
aicommand.py - CLI to call dara_bot backend (chat + code agent).
Kali-style terminal UI. Uses POST /api/message or POST /api/agent.
"""

import argparse
import json
import re
import subprocess
import sys
import time

try:
    import requests
except ImportError:
    print("Install requests: pip install requests", file=sys.stderr)
    sys.exit(1)

# ANSI (no extra deps)
R = "\033[0m"
G = "\033[92m"   # green
C = "\033[96m"   # cyan
Y = "\033[93m"   # yellow
R_ = "\033[91m"  # red
D = "\033[2m"    # dim
B = "\033[1m"    # bold


BANNER = f"""
{D}╔══════════════════════════════════════════════════════════════╗
║  {C}▄▀█ █▀█ █▀ ▀█▀ █▀█ █▀█ █▄▄ █ ▀█▀ █▀█{R}  {D}║
║  {C}█▄█ █▄█ ▄█  █  █▄█ █▀▄ █▄█ █  █  █▄█{R}  {D}║
║  {G}[*] AI COMMAND v1.0  |  Backend: dara_bot  |  /api/message | /api/agent{R}  {D}║
╚══════════════════════════════════════════════════════════════╝{R}
"""


def log(status: str, msg: str):
    if status == "info":
        print(f"  {C}[*]{R} {msg}")
    elif status == "ok":
        print(f"  {G}[+]{R} {msg}")
    elif status == "warn":
        print(f"  {Y}[!]{R} {msg}")
    elif status == "fail":
        print(f"  {R_}[−]{R} {msg}")


def typewrite(text: str, delay: float = 0.015, use: bool = True):
    if not use or not text:
        return
    for c in text:
        sys.stdout.write(c)
        sys.stdout.flush()
        if c in "\n":
            continue
        time.sleep(delay)
    print()


def chat(base_url: str, message: str, user_id: str = None, chat_id: str = None) -> dict:
    url = f"{base_url.rstrip('/')}/api/message"
    payload = {"message": message}
    if user_id is not None:
        payload["userId"] = user_id
    if chat_id is not None:
        payload["chatId"] = chat_id
    r = requests.post(url, json=payload, timeout=60)
    r.raise_for_status()
    return r.json()


def agent(
    base_url: str,
    message: str,
    session_id: str = "default",
    workspace_root: str = None,
    current_file_path: str = None,
    current_file_content: str = None,
    selected_text: str = None,
) -> dict:
    url = f"{base_url.rstrip('/')}/api/agent"
    payload = {
        "message": message,
        "sessionId": session_id,
        "workspaceRoot": workspace_root or "",
        "currentFilePath": current_file_path or "",
        "currentFileContent": current_file_content or "",
        "selectedText": selected_text or "",
    }
    r = requests.post(url, json=payload, timeout=120)
    r.raise_for_status()
    return r.json()


def run_once(args, base_url: str, message: str, silent: bool) -> dict:
    """Send one message, print result; returns response data."""
    if args.agent:
        file_content = None
        file_path = None
        if args.file_path:
            try:
                with open(args.file_path, "r", encoding="utf-8", errors="replace") as f:
                    file_content = f.read()
                file_path = args.file_path
                if not silent:
                    log("ok", f"Loaded file: {file_path}")
            except OSError as e:
                log("fail", f"Read error: {e}")
                raise SystemExit(1)
        data = agent(
            base_url,
            message,
            session_id=args.session,
            workspace_root=args.workspace,
            current_file_path=file_path,
            current_file_content=file_content,
            selected_text=args.selected_text,
        )
    else:
        data = chat(base_url, message, user_id=args.user_id, chat_id=args.chat_id)
    return data


def extract_run_command(data: dict) -> str | None:
    """Get a single shell command from actions or from markdown code blocks in response."""
    actions = data.get("actions") or []
    for a in actions:
        if a.get("type") == "run" and a.get("command"):
            return a["command"].strip()
    text = data.get("response", "")
    # First ```bash, ```sh, or ``` block; first non-empty, non-comment line
    for pattern in (r"```(?:bash|sh)\s*\n([\s\S]*?)```", r"```\s*\n([\s\S]*?)```"):
        for m in re.finditer(pattern, text):
            block = m.group(1).strip()
            for line in block.splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                # Skip common non-command lines
                if line.startswith("**") or line.startswith("* ") or line.startswith("```"):
                    continue
                return line
    return None


def run_command(cmd: str, silent: bool) -> bool:
    """Run shell command and print stdout/stderr. Returns True if exit code 0."""
    if not silent:
        print(f"  {C}{B}═══ EXEC ═══{R}  {Y}{cmd}{R}")
        print()
    try:
        out = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=60,
        )
        if out.stdout:
            print(out.stdout)
        if out.stderr:
            print(out.stderr, file=sys.stderr)
        if not silent and out.returncode != 0:
            log("warn", f"Exit code: {out.returncode}")
        return out.returncode == 0
    except subprocess.TimeoutExpired:
        if not silent:
            log("fail", "Command timed out (60s)")
        return False
    except Exception as e:
        if not silent:
            log("fail", str(e))
        return False


def print_result(data: dict, silent: bool, no_type: bool):
    if silent:
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return
    response = data.get("response", "")
    print()
    print(f"  {G}{B}═══ OUTPUT ═══{R}")
    print()
    if response:
        typewrite(response, delay=0.012, use=not no_type)
    else:
        print("  (empty)")
    print()
    actions = data.get("actions")
    if actions and isinstance(actions, list) and len(actions) > 0:
        print(f"  {C}{B}═══ ACTIONS ═══{R}")
        for i, a in enumerate(actions, 1):
            if a.get("type") == "edit":
                print(f"  {C}[{i}]{R} edit {G}{a.get('path', '?')}{R}")
            elif a.get("type") == "run":
                print(f"  {C}[{i}]{R} run  {Y}{a.get('command', '?')}{R}")
        print()


def main():
    p = argparse.ArgumentParser(
        description="AI command interface — chat or code agent (Kali-style CLI).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f"""
{G}Examples:{R}
  python aicommand.py "សួស្តី"
  python aicommand.py -i                    # standby mode, prompt >
  python aicommand.py --agent -x "check busy ports"   # human lang → run command
  python aicommand.py --agent "list listening ports"  # then prompt: Run? [y/N]
  python aicommand.py --agent "explain this" --file ./server.js
  python aicommand.py -u https://your-bot.onrender.com "hello"
""",
    )
    p.add_argument("message", nargs="?", default=None, help="Message to send (or use -m)")
    p.add_argument("-m", "--message", dest="message_flag", help="Message to send")
    p.add_argument("-u", "--url", default="https://bot01-97f8.onrender.com", help="Backend base URL")
    p.add_argument("--user-id", help="Optional user ID for /api/message")
    p.add_argument("--chat-id", help="Optional chat ID for /api/message")
    p.add_argument("--agent", action="store_true", help="Use /api/agent (code agent)")
    p.add_argument("--session", default="default", help="Agent session ID")
    p.add_argument("--workspace", help="Workspace root for agent")
    p.add_argument("-f", "--file", dest="file_path", metavar="FILE", help="Send file as context")
    p.add_argument("-s", "--select", dest="selected_text", metavar="TEXT", help="Selected text")
    p.add_argument("--raw", action="store_true", help="Print raw JSON (no banner/colors)")
    p.add_argument("--no-type", action="store_true", help="Print response at once (no typewriter)")
    p.add_argument("-i", "--interactive", action="store_true", help="Standby mode: keep prompting > for more messages")
    p.add_argument("-x", "--run", action="store_true", help="Run suggested command (human lang → execute); use with --agent")
    args = p.parse_args()

    message = args.message or args.message_flag
    if not message and not args.interactive:
        p.error("Message required: pass as argument, use -m/--message, or use -i for interactive standby")

    base_url = args.url
    silent = args.raw

    if not silent:
        print(BANNER)
        log("info", f"Target: {base_url}")
        log("info", "Connecting to backend...")
        if args.agent:
            log("info", "Mode: code agent (/api/agent)")
        else:
            log("info", "Mode: chat (/api/message)")

    def do_request(msg: str):
        if not silent:
            log("info", "Querying AI...")
        data = run_once(args, base_url, msg, silent)
        if not silent:
            log("ok", "Response received")
        print_result(data, silent, args.no_type)
        # Human lang → run command: from actions or from response code blocks
        cmd = extract_run_command(data)
        if cmd:
            if args.run:
                run_command(cmd, silent)
            elif not silent and sys.stdin.isatty():
                try:
                    ans = input(f"  {C}Run command? [y/N]{R} ").strip().lower()
                    if ans in ("y", "yes"):
                        run_command(cmd, silent)
                except EOFError:
                    pass
        return data

    try:
        if args.interactive:
            if not silent:
                log("ok", "Standby. Type a message and press Enter. exit/quit/q to leave.")
                print()
            # Optional first message from CLI
            if message:
                do_request(message)
            while True:
                try:
                    prompt = f"  {G}>{R} "
                    line = input(prompt).strip()
                except EOFError:
                    break
                if not line:
                    continue
                if line.lower() in ("exit", "quit", "q"):
                    if not silent:
                        print(f"  {D}[ session ended ]{R}")
                    break
                try:
                    do_request(line)
                except requests.exceptions.ConnectionError:
                    log("fail", "Connection refused. Is the backend running?")
                except requests.exceptions.HTTPError as e:
                    log("fail", f"HTTP {e.response.status_code}")
                except requests.exceptions.Timeout:
                    log("fail", "Request timed out.")
            return

        # Single shot
        do_request(message)
        if not silent:
            print(f"  {D}[ session ended ]{R}")

    except requests.exceptions.ConnectionError:
        if not silent:
            log("fail", "Connection refused. Is the backend running?")
        else:
            print("Connection failed.", file=sys.stderr)
        sys.exit(1)
    except requests.exceptions.HTTPError as e:
        if not silent:
            log("fail", f"HTTP {e.response.status_code}")
            if e.response.text:
                print(f"  {D}{e.response.text[:400]}{R}")
        else:
            print(f"HTTP error: {e.response.status_code}", file=sys.stderr)
            if e.response.text:
                print(e.response.text[:500], file=sys.stderr)
        sys.exit(1)
    except requests.exceptions.Timeout:
        if not silent:
            log("fail", "Request timed out.")
        else:
            print("Timeout.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
