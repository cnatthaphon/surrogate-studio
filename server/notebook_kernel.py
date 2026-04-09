"""
Notebook Kernel — persistent Python session for cell-by-cell execution.

Reads JSON commands from stdin, executes code, writes JSON results to stdout.
Keeps state between cells (variables, imports, etc.).

Protocol:
  Input:  {"kind": "execute", "code": "print('hello')"}
  Output: {"kind": "result", "stdout": "hello\n", "stderr": "", "images": [], "error": null}

  Input:  {"kind": "shutdown"}
  Output: (process exits)
"""
import sys
import json
import io
import traceback
import base64
import types

# Persistent namespace for all cell executions
_NAMESPACE = {"__name__": "__main__", "__builtins__": __builtins__}


def _capture_matplotlib():
    """If matplotlib is loaded, capture all open figures as base64 PNG."""
    images = []
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        for fig_num in plt.get_fignums():
            fig = plt.figure(fig_num)
            buf = io.BytesIO()
            fig.savefig(buf, format="png", bbox_inches="tight", dpi=100, facecolor="#0b1220")
            buf.seek(0)
            images.append(base64.b64encode(buf.read()).decode("ascii"))
            buf.close()
        plt.close("all")
    except ImportError:
        pass
    except Exception:
        pass
    return images


def _execute_cell(code):
    """Execute a code cell and capture output."""
    stdout_capture = io.StringIO()
    stderr_capture = io.StringIO()

    old_stdout = sys.stdout
    old_stderr = sys.stderr
    sys.stdout = stdout_capture
    sys.stderr = stderr_capture

    error = None
    try:
        # Try exec first (for statements), fall back to eval for expressions
        compiled = compile(code, "<cell>", "exec")
        exec(compiled, _NAMESPACE)
    except Exception:
        error = traceback.format_exc()
    finally:
        sys.stdout = old_stdout
        sys.stderr = old_stderr

    images = _capture_matplotlib()

    return {
        "kind": "result",
        "stdout": stdout_capture.getvalue(),
        "stderr": stderr_capture.getvalue(),
        "images": images,
        "error": error,
    }


def main():
    # Set matplotlib backend before anything imports it
    try:
        import matplotlib
        matplotlib.use("Agg")
    except ImportError:
        pass

    # Read lines from stdin
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            print(json.dumps({"kind": "error", "message": "Invalid JSON"}), flush=True)
            continue

        kind = msg.get("kind", "")

        if kind == "shutdown":
            break

        if kind == "execute":
            code = msg.get("code", "")
            result = _execute_cell(code)
            print(json.dumps(result), flush=True)
            continue

        if kind == "ping":
            print(json.dumps({"kind": "pong"}), flush=True)
            continue

        print(json.dumps({"kind": "error", "message": "Unknown kind: " + kind}), flush=True)


if __name__ == "__main__":
    main()
