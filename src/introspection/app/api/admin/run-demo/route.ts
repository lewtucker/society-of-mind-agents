import { spawn } from "node:child_process";
import { join }  from "node:path";

export const dynamic = "force-dynamic";

const DEMOS: Record<string, { script: string; label: string }> = {
  "block-builder":    { script: "scripts/seed-demo.ts",              label: "Block Builder" },
  "cross-society":    { script: "scripts/seed-cross-society.ts",     label: "Cross-Society Retrieval" },
  "learning-curve":   { script: "scripts/seed-learning-curve.ts",    label: "Learning Curve" },
};

export async function POST(req: Request) {
  const { demo } = await req.json() as { demo: string };
  const def = DEMOS[demo];
  if (!def) return new Response("Unknown demo", { status: 400 });

  // process.cwd() is src/introspection when running next dev
  const coreDir   = join(process.cwd(), "..", "core");
  const scriptPath = join(coreDir, def.script);
  const tsxBin    = join(coreDir, "node_modules", ".bin", "tsx");

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const child = spawn(tsxBin, [scriptPath], { cwd: coreDir });

      child.stdout.on("data", (chunk: Buffer) => {
        try { controller.enqueue(encoder.encode(chunk.toString())); } catch { /* client gone */ }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        try { controller.enqueue(encoder.encode(chunk.toString())); } catch { /* client gone */ }
      });
      child.on("close", (code) => {
        try {
          controller.enqueue(encoder.encode(`\n[exited with code ${code}]`));
          controller.close();
        } catch { /* client gone */ }
      });
    },
    cancel() { /* child continues; output just stops reaching client */ },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
