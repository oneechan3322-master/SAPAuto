"""Loopback-only Gemma 4 inference endpoint for SAPAuto V8."""

import hmac
import json
import os
import re
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


def parse_tool_calls(content: str, allowed_names: set[str]) -> tuple[str, list[dict[str, Any]]]:
    calls = []
    output = content
    offset = 0
    while True:
        match = TOOLS_PATTERN.search(output, offset)
        if not match:
            break
        name = match.group(1)
        if name not in allowed_names:
            raise ValueError("Model requested a tool outside the supplied registry")
        start = match.end()
        if start >= len(output) or output[start] != "{":
            raise ValueError("Model returned malformed Gemma tool arguments")
        depth = 0
        in_string = False
        escaped = False
        end = -1
        for index in range(start, len(output)):
            char = output[index]
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
                    end = index + 1
                    break
        closing = "<tool_call|>"
        if end < 0 or not output.startswith(closing, end):
            raise ValueError("Model returned an incomplete Gemma tool call")
        try:
            arguments = json.loads(output[start:end])
        except json.JSONDecodeError as exc:
            raise ValueError("Model returned invalid Gemma tool arguments") from exc
        if not isinstance(arguments, dict):
            raise ValueError("Gemma tool arguments must be a JSON object")
        calls.append({
            "id": f"call_{uuid.uuid4().hex}",
            "type": "function",
            "function": {"name": name, "arguments": json.dumps(arguments, ensure_ascii=False)},
        })
        output = output[:match.start()] + output[end + len(closing):]
        offset = match.start()
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
        options: dict[str, Any] = {
            "messages": messages,
            "temperature": 0.1,
            "max_tokens": 384,
        }
        if tools:
            options["tools"] = tools
            options["tool_choice"] = "auto"
        try:
            result = MODEL.create_chat_completion(**options)
            choice = result["choices"][0]
            message = choice.get("message", {})
            content = message.get("content") or ""
            tool_calls = message.get("tool_calls") or []
            if not tool_calls and "<|tool_call>call:" in content:
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
    n_ctx=4096,
    n_threads=max(1, os.cpu_count() or 4),
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
