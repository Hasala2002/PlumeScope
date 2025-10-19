import fs from "fs";
import { z } from "zod";
import { Site, SiteSchema } from "../types.js";

const DATA_URL = new URL("../../data/sites.json", import.meta.url);

function readRawJson(): unknown {
  const raw = fs.readFileSync(DATA_URL, "utf8");
  // Strip potential BOM from JSON files
  const sanitized = raw.replace(/^\uFEFF/, "");
  return JSON.parse(sanitized);
}

export function getAll(): Site[] {
  const raw = readRawJson();
  if (!Array.isArray(raw)) {
    console.warn("[sitesRepo] sites.json is not an array; returning []");
    return [];
  }
  const valid: Site[] = [];
  raw.forEach((rec, idx) => {
    const parsed = SiteSchema.safeParse(rec);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      const id = (rec && typeof rec === "object" && (rec as any).id) || `#${idx}`;
      console.warn(
        `[sitesRepo] skipping invalid site ${id}:` ,
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      );
    }
  });
  return valid;
}

export function getById(id: string): Site | undefined {
  return getAll().find((s) => s.id === id);
}

export function saveAll(sites: Site[]): void {
  // Validate before writing to disk
  const arr = z.array(SiteSchema);
  const parsed = arr.safeParse(sites);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Refusing to write invalid sites: ${msg}`);
  }
  const json = JSON.stringify(parsed.data, null, 2) + "\n";
  fs.writeFileSync(DATA_URL, json, "utf8");
}
