import { Router } from "express";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

export const charts = Router();

// POST /charts/generate
// Body: { picks: {id:string, cost:number, benefit:number}[], sites: any[] }
charts.post("/generate", async (req, res) => {
  try {
    const { picks = [], sites = [] } = req.body || {};

    // Resolve Python script path robustly across dev/prod and monorepo root
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(here, "../charts/generate_charts.py"), // dev (src)
      path.resolve(process.cwd(), "src/charts/generate_charts.py"), // workspace cwd
      path.resolve(process.cwd(), "charts/generate_charts.py"), // fallback if copied at build
      path.resolve(process.cwd(), "apps/api/src/charts/generate_charts.py"), // monorepo root cwd
    ];
    const scriptPath = candidates.find((p) => fs.existsSync(p));
    if (!scriptPath) {
      return res.status(500).json({
        error: "chart_script_missing",
        message: "Could not locate generate_charts.py",
        tried: candidates,
      });
    }

    // Spawn python process and pass JSON via stdin
    const trySpawn = (cmd: string) =>
      spawn(cmd, ["-u", scriptPath], { stdio: ["pipe", "pipe", "pipe"] });

    let py = trySpawn("python");
    let fallbackTried = false;

    const input = JSON.stringify({ picks, sites });

    const attachHandlers = (child: ReturnType<typeof spawn>) => {
      let stdout = "";
      let stderr = "";

      child.stdin!.write(input);
      child.stdin!.end();

      child.stdout?.on("data", (d) => (stdout += d.toString())).on("error", () => {});
      child.stderr?.on("data", (d) => (stderr += d.toString())).on("error", () => {});

      child.on("error", (err: any) => {
        if (!fallbackTried && process.platform === "win32") {
          // Try Windows launcher
          fallbackTried = true;
          const pyw = trySpawn("py");
          attachHandlers(pyw);
        } else {
          res.status(503).json({ error: "python_not_found", message: String(err) });
        }
      });

      child.on("close", (code) => {
        if (code !== 0) {
          return res.status(503).json({
            error: "chart_generation_failed",
            message:
              stderr ||
              "Python exited with non-zero status. Ensure Python, matplotlib, networkx are installed.",
          });
        }
        try {
          const parsed = JSON.parse(stdout);
          return res.json(parsed);
        } catch (e) {
          return res.status(500).json({
            error: "invalid_python_output",
            message: "Failed to parse chart generator output as JSON",
            raw: stdout.slice(0, 2000),
          });
        }
      });
    };

    attachHandlers(py);
  } catch (err) {
    return res.status(500).json({ error: "internal_error", message: String(err) });
  }
});