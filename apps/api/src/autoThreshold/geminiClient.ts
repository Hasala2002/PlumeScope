import fetch from "node-fetch";
import { z } from "zod";

const Resp = z.object({
  C_thr: z.number().positive(),
  percentile: z.number().min(0).max(100).optional(),
  precision_proxy: z.number().min(0).max(1),
  area_km2: z.number().min(0),
  method: z.string(),
  rationale: z.string().optional(),
});
export type GeminiResp = z.infer<typeof Resp>;

function sleep(ms:number){ return new Promise(r=>setTimeout(r, ms)); }

export async function chooseThresholdGemini(payload:any, apiKey:string): Promise<GeminiResp> {
  if (!apiKey) throw new Error("missing-api-key");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;

  const prompt = `You are selecting an absolute concentration threshold C_thr to delineate an affected area from a 24h log-space histogram of per-cell maxima.
Return STRICT JSON ONLY with fields {C_thr, percentile?, precision_proxy, area_km2, method, rationale?}.
Constraints: C_thr > 0; 0<=precision_proxy<=1; area_km2>=0; if using percentile, set it [0,100].
Prefer small, conservative C_thr that meets constraints and is explainable (e.g., Otsu or high percentile).`;

  const body = {
    contents: [{ role: "user", parts: [{ text: `${prompt}\nInput: ${JSON.stringify(payload)}` }]}],
    generationConfig: { responseMimeType: "application/json" },
  } as const;

  const attempt = async(signal:AbortSignal) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error(`gemini-http-${res.status}`);
    const data = await res.json() as any;
    const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text || typeof text !== "string") throw new Error("gemini-no-text");
    let json: unknown;
    try { json = JSON.parse(text); } catch { throw new Error("gemini-non-json"); }
    return Resp.parse(json);
  };

  const timeoutMs = 6000;
  for (let attemptIdx=0; attemptIdx<2; attemptIdx++){
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), timeoutMs);
    try {
      const out = await attempt(ctrl.signal);
      clearTimeout(t);
      return out;
    } catch (e) {
      clearTimeout(t);
      if (attemptIdx === 0) await sleep(200); else throw e;
    }
  }
  throw new Error("gemini-unknown");
}
