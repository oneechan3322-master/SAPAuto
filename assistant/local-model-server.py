"""Loopback-only Gemma 4 inference endpoint for SAPAuto V8."""

import hmac
import json
import os
import re
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from llama_cpp import Llama

MAX_BODY_BYTES = 512 * 1024
MODEL_PATH = Path(os.environ["V8_LOCAL_MODEL_FILE"]).resolve()
API_TOKEN = os.environ.get("V8_LOCAL_AI_TOKEN", "")
PORT = int(os.environ.get("V8_LOCAL_AI_PORT", "7799"))
TOOLS_PATTERN = re.compile(r"<\|tool_call>call:([A-Za-z_][A-Za-z0-9_]*)")
LEGACY_CALL_PATTERN = re.compile(
    r"\{\s*\"tool_name\"\s*:\s*\"([A-Za-z_][A-Za-z0-9_]*)\"\s*,\s*\"parameters\"\s*:\s*",
    re.S,
)
CLOSING_MARKER = "<tool_call|>"
# llama.cpp is not safe to drive concurrently through one Llama instance. A
# threaded HTTP server is useful for health checks, but inference itself must
# be single-filed or native crashes can take the entire local assistant down.
INFERENCE_LOCK = threading.Lock()


def scan_object_end(text: str, start: int) -> int:
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index + 1
    return -1


def load_arguments(raw: str) -> dict[str, Any]:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        repaired = re.sub(r",\s*([}\]])", r"\1", raw)
        if '"' not in repaired:
            repaired = repaired.replace("'", '"')
        repaired = re.sub(r"([{,])\s*([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', repaired)
        try:
            value = json.loads(repaired)
        except json.JSONDecodeError:
            return {}
    return value if isinstance(value, dict) else {}


def build_call(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"call_{uuid.uuid4().hex}",
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(arguments, ensure_ascii=False)},
    }


def parse_tool_calls(content: str, allowed_names: set[str]) -> tuple[str, list[dict[str, Any]]]:
    calls = []
    output = content
    while True:
        match = TOOLS_PATTERN.search(output)
        if not match:
            break
        name = match.group(1)
        if name not in allowed_names:
            raise ValueError("Model requested a tool outside the supplied registry")
        start = match.end()
        arguments: dict[str, Any] = {}
        consumed = start
        if start < len(output) and output[start] == "{":
            end = scan_object_end(output, start)
            if end > 0:
                arguments = load_arguments(output[start:end])
                consumed = end
                closing = re.match(r"\s*" + re.escape(CLOSING_MARKER), output[end:])
                if closing:
                    consumed += closing.end()
        calls.append(build_call(name, arguments))
        output = output[:match.start()] + output[consumed:]
    if not calls:
        # Gemma sometimes wraps a legacy call in a Markdown `json` fence. The
        # old pattern consumed only the parameters object and left the outer
        # closing brace in the visible answer. Parse the complete JSON object
        # instead, so a tool request cannot be shown to the user as prose.
        for start, char in enumerate(output):
            if char != "{":
                continue
            end = scan_object_end(output, start)
            if end <= 0:
                continue
            candidate = load_arguments(output[start:end])
            name = candidate.get("tool_name")
            arguments = candidate.get("parameters")
            if name in allowed_names and isinstance(arguments, dict):
                calls.append(build_call(name, arguments))
                output = output[:start] + output[end:]
                break
    if not calls:
        legacy = LEGACY_CALL_PATTERN.search(output)
        if legacy and legacy.group(1) in allowed_names:
            name = legacy.group(1)
            start = legacy.end()
            arguments: dict[str, Any] = {}
            consumed = legacy.start()
            if start < len(output) and output[start] == "{":
                end = scan_object_end(output, start)
                if end > 0:
                    arguments = load_arguments(output[start:end])
                    consumed = end
            calls.append(build_call(name, arguments))
            output = output[:legacy.start()] + output[consumed:]
    return output.strip(), calls


class Handler(BaseHTTPRequestHandler):
    server_version = "SAPAutoV8LocalAI/1.0"

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def authorized(self) -> bool:
        if not API_TOKEN:
            return True
        header = self.headers.get("Authorization", "")
        expected = f"Bearer {API_TOKEN}"
        return hmac.compare_digest(header, expected)

    def do_GET(self) -> None:
        if self.path.rstrip("/") in ("/health", "/v1/health"):
            self.send_json(200, {
                "status": "ok",
                "modelLoaded": True,
                "model": MODEL_PATH.name,
                "provider": "local-gguf",
            })
        elif self.path.rstrip("/") == "/v1/models":
            self.send_json(200, {
                "object": "list",
                "data": [{"id": "gemma4-local", "object": "model", "owned_by": "local"}],
            })
        else:
            self.send_json(404, {"error": {"message": "Not found"}})

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/v1/chat/completions":
            self.send_json(404, {"error": {"message": "Not found"}})
            return
        if not self.authorized():
            self.send_json(401, {"error": {"message": "Invalid or missing bearer token"}})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"error": {"message": "Invalid content length"}})
            return
        if length <= 0 or length > MAX_BODY_BYTES:
            self.send_json(413, {"error": {"message": "Request body is empty or too large"}})
            return
        try:
            request = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(400, {"error": {"message": "Request body must be valid JSON"}})
            return
        messages = request.get("messages") if isinstance(request, dict) else None
        tools = request.get("tools", []) if isinstance(request, dict) else []
        if not isinstance(messages, list) or not messages or not isinstance(tools, list):
            self.send_json(400, {"error": {"message": "A messages array is required"}})
            return
        allowed_names = {
            item.get("function", {}).get("name")
            for item in tools
            if isinstance(item, dict) and isinstance(item.get("function"), dict)
            and isinstance(item["function"].get("name"), str)
        }
        if tools:
            catalog = "\n".join(
                f"- {item['function'].get('name')}: {item['function'].get('description', '')} parameters={json.dumps(item['function'].get('parameters', {}), ensure_ascii=False)}"
                for item in tools
                if isinstance(item, dict) and isinstance(item.get("function"), dict)
                and isinstance(item["function"].get("name"), str)
            )
            guidance = (
                "You can call the tools below. To call one, emit exactly "
                '<|tool_call>call:NAME{"argument":"value"}<tool_call|> and nothing else for that call. '
                "Use the real values from the conversation; never invent names outside this list.\n"
                "Available tools:\n" + catalog
            )
            messages = list(messages)
            if messages and messages[0].get("role") == "system" and isinstance(messages[0].get("content"), str):
                messages[0] = {**messages[0], "content": f"{messages[0]['content']}\n\n{guidance}"}
            else:
                messages = [{"role": "system", "content": guidance}, *messages]
            request["messages"] = messages
        options: dict[str, Any] = {
            "messages": messages,
            "temperature": 0.1,
            "max_tokens": 512,
        }
        try:
            # Only one inference may use the native model at a time. Without
            # this lock simultaneous dashboard/WhatsApp requests can crash the
            # process (Windows exit code 0xC0000005).
            with INFERENCE_LOCK:
                result = MODEL.create_chat_completion(**options)
            choice = result["choices"][0]
            message = choice.get("message", {})
            content = message.get("content") or ""
            tool_calls = message.get("tool_calls") or []
            if not tool_calls:
                content, tool_calls = parse_tool_calls(content, allowed_names)
            for call in tool_calls:
                if call.get("function", {}).get("name") not in allowed_names:
                    raise ValueError("Model requested a tool outside the supplied registry")
            self.send_json(200, {
                "id": f"chatcmpl-{uuid.uuid4().hex}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": "gemma4-local",
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": content, "tool_calls": tool_calls},
                    "finish_reason": "tool_calls" if tool_calls else "stop",
                }],
                "usage": result.get("usage", {}),
            })
        except ValueError as error:
            self.send_json(422, {"error": {"message": str(error)}})
        except Exception as error:
            print(f"Local inference failed ({type(error).__name__})", flush=True)
            self.send_json(503, {"error": {"message": "Local inference is unavailable"}})


if not MODEL_PATH.is_file():
    raise FileNotFoundError(f"Configured GGUF model is missing: {MODEL_PATH}")
if MODEL_PATH.open("rb").read(4) != b"GGUF":
    raise ValueError("Configured local model does not have a valid GGUF header")

print(f"Loading local model: {MODEL_PATH.name}", flush=True)
MODEL = Llama(
    model_path=str(MODEL_PATH),
    # The office host is close to its memory limit. These bounds keep the
    # local lane alive; requests over the limit are handled by the application
    # rather than exhausting Windows memory.
    n_ctx=4096,
    n_batch=128,
    n_threads=max(1, min(4, os.cpu_count() or 4)),
    flash_attn=True,
    verbose=False,
)
server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
server.daemon_threads = True
print(f"Local Gemma API ready at http://127.0.0.1:{PORT}", flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
