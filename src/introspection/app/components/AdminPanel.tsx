"use client";

import { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Demo {
  id:          string;
  label:       string;
  description: string;
}

const DEMOS: Demo[] = [
  {
    id:          "block-builder",
    label:       "Block Builder",
    description: "3-block tower build — agents coordinate via polyneme bus, K-line captured on success",
  },
  {
    id:          "cross-society",
    label:       "Cross-Society Retrieval",
    description: "Block build then conversation — shows conversation agents finding builder K-lines",
  },
  {
    id:          "learning-curve",
    label:       "Learning Curve",
    description: "5 builds in sequence — watch K-line count and retrieval scores improve over time",
  },
];

// ─── AdminPanel ───────────────────────────────────────────────────────────────

export default function AdminPanel() {
  const [open,       setOpen]       = useState(false);
  const [demo,       setDemo]       = useState(DEMOS[0].id);
  const [running,    setRunning]    = useState(false);
  const [clearing,   setClearing]   = useState(false);
  const [output,     setOutput]     = useState<string[]>([]);
  const [confirmed,  setConfirmed]  = useState(false);

  const selectedDemo = DEMOS.find((d) => d.id === demo)!;

  async function runDemo() {
    setRunning(true);
    setOutput([`▶ Running: ${selectedDemo.label}…`, ""]);

    try {
      const res = await fetch("/api/admin/run-demo", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ demo }),
      });
      if (!res.body) throw new Error("No response body");

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buf     = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        setOutput((prev) => [...prev, ...lines]);
      }
      if (buf) setOutput((prev) => [...prev, buf]);
    } catch (err) {
      setOutput((prev) => [...prev, `Error: ${String(err)}`]);
    } finally {
      setRunning(false);
    }
  }

  async function clearData() {
    setClearing(true);
    setOutput(["⚠ Clearing ~/.som/events.db and ~/.som/klines.db…"]);
    try {
      const res  = await fetch("/api/admin/clear-data", { method: "POST" });
      const data = await res.json() as { removed: string[] };
      setOutput([
        "✓ Cleared:",
        ...data.removed.map((f) => `  ${f}`),
        "",
        "Next: stop the dev server (Ctrl+C) and run  npm run dev  to restart cleanly.",
      ]);
    } catch (err) {
      setOutput([`Error: ${String(err)}`]);
    } finally {
      setClearing(false);
      setConfirmed(false);
    }
  }

  return (
    <div className="shrink-0 border-b som-border-strong som-panel">
      {/* Toggle row */}
      <div className="flex items-center gap-3 px-6 py-2">
        <button
          onClick={() => setOpen((o) => !o)}
          className="som-btn rounded border px-2.5 py-0.5 font-mono text-xs transition-colors"
        >
          {open ? "▲ Admin" : "▼ Admin"}
        </button>
        {!open && (
          <span className="font-mono text-xs som-text-muted">
            Run demos · Clear data
          </span>
        )}
      </div>

      {/* Expanded panel */}
      {open && (
        <div className="flex flex-col gap-4 px-6 pb-4">
          <div className="flex flex-wrap gap-6">

            {/* ── Run Demo ── */}
            <div className="flex flex-col gap-2 min-w-64">
              <span className="font-mono text-xs font-semibold uppercase tracking-widest som-text-primary">
                Run Demo
              </span>
              <select
                value={demo}
                onChange={(e) => setDemo(e.target.value)}
                className="som-input rounded border px-2 py-1 font-mono text-xs"
              >
                {DEMOS.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
              <p className="font-mono text-xs som-text-muted leading-snug">
                {selectedDemo.description}
              </p>
              <button
                onClick={runDemo}
                disabled={running}
                className="self-start som-btn rounded border px-3 py-1 font-mono text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              >
                {running ? "Running…" : "▶ Run"}
              </button>
            </div>

            {/* ── Clear Data ── */}
            <div className="flex flex-col gap-2">
              <span className="font-mono text-xs font-semibold uppercase tracking-widest som-text-primary">
                Clear Data
              </span>
              <p className="font-mono text-xs som-text-muted leading-snug">
                Deletes ~/.som/events.db and klines.db.<br />
                Returns app to simulation mode.
              </p>
              {!confirmed ? (
                <button
                  onClick={() => setConfirmed(true)}
                  disabled={clearing}
                  className="self-start rounded border px-3 py-1 font-mono text-xs transition-colors som-text-error border-current hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Clear All Data
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs som-text-error">Sure?</span>
                  <button
                    onClick={clearData}
                    className="rounded border px-2.5 py-0.5 font-mono text-xs som-text-error border-current hover:opacity-80"
                  >
                    Yes, clear
                  </button>
                  <button
                    onClick={() => setConfirmed(false)}
                    className="som-btn rounded border px-2.5 py-0.5 font-mono text-xs"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Output log */}
          {output.length > 0 && (
            <div className="som-result rounded border p-3 font-mono text-xs som-text-primary leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
              {output.join("\n")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
