import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";

// Zod schema for validating Gemini's markdown response
const GeminiResponseSchema = z.object({
  markdown: z.string().min(1, "Response must not be empty"),
});

export type GeminiResponse = z.infer<typeof GeminiResponseSchema>;

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(
  process.env.NEXT_PUBLIC_GEMINI_API_KEY || ""
);

// Schema for site data
interface Site {
  id: string;
  name: string;
  lat: number;
  lon: number;
  CO2e_tpy: number;
  CH4_tpy: number;
  EmissionsScore: number;
  FloodScore: number;
  HeatScore: number;
  DroughtScore: number;
  Risk: number;
}

// Function to format statistical data for the prompt
function formatStatisticalData(sites: Site[]): string {
  const totalSites = sites.length;
  const totalCO2e = sites.reduce((sum, s) => sum + s.CO2e_tpy, 0);
  const totalCH4 = sites.reduce((sum, s) => sum + s.CH4_tpy, 0);
  const avgRisk = sites.reduce((sum, s) => sum + s.Risk, 0) / sites.length;
  const avgEmissions =
    sites.reduce((sum, s) => sum + s.EmissionsScore, 0) / sites.length;
  const avgFlood =
    sites.reduce((sum, s) => sum + s.FloodScore, 0) / sites.length;
  const avgHeat = sites.reduce((sum, s) => sum + s.HeatScore, 0) / sites.length;
  const avgDrought =
    sites.reduce((sum, s) => sum + s.DroughtScore, 0) / sites.length;
  const highRiskSites = sites.filter((s) => s.Risk >= 0.7).length;
  const topRiskSite = sites.reduce(
    (max, s) => (s.Risk > max.Risk ? s : max),
    sites[0]
  );
  const topEmissionsSite = sites.reduce(
    (max, s) => (s.EmissionsScore > max.EmissionsScore ? s : max),
    sites[0]
  );

  // Risk distribution
  const riskBins = [
    {
      label: "0.0-0.2",
      count: sites.filter((s) => s.Risk >= 0.0 && s.Risk < 0.2).length,
    },
    {
      label: "0.2-0.4",
      count: sites.filter((s) => s.Risk >= 0.2 && s.Risk < 0.4).length,
    },
    {
      label: "0.4-0.6",
      count: sites.filter((s) => s.Risk >= 0.4 && s.Risk < 0.6).length,
    },
    {
      label: "0.6-0.8",
      count: sites.filter((s) => s.Risk >= 0.6 && s.Risk < 0.8).length,
    },
    {
      label: "0.8-1.0",
      count: sites.filter((s) => s.Risk >= 0.8 && s.Risk <= 1.0).length,
    },
  ];

  return `ANALYTICS DATA SUMMARY:

OVERVIEW:
- Total Sites: ${totalSites}
- High Risk Sites (≥0.7): ${highRiskSites}
- Total CO2 Equivalent: ${totalCO2e.toLocaleString()} tonnes per year
- Total Methane: ${totalCH4.toLocaleString()} tonnes per year

AVERAGE SCORES:
- Risk Score: ${avgRisk.toFixed(3)}
- Emissions Score: ${avgEmissions.toFixed(3)}
- Flood Score: ${avgFlood.toFixed(3)}
- Heat Score: ${avgHeat.toFixed(3)}
- Drought Score: ${avgDrought.toFixed(3)}

TOP CONCERNS:
- Highest Risk Site: ${topRiskSite.name} (Risk: ${topRiskSite.Risk.toFixed(3)})
  - Flood Score: ${topRiskSite.FloodScore.toFixed(3)}
  - Heat Score: ${topRiskSite.HeatScore.toFixed(3)}
  - Drought Score: ${topRiskSite.DroughtScore.toFixed(3)}
- Highest Emissions Site: ${topEmissionsSite.name} (Emissions: ${topEmissionsSite.EmissionsScore.toFixed(3)})

RISK DISTRIBUTION:
${riskBins.map((bin) => `- ${bin.label}: ${bin.count} sites`).join("\n")}

INDIVIDUAL SITE DATA:
${sites
  .map(
    (site) => `
${site.name}:
- Risk: ${site.Risk.toFixed(3)}
- Emissions: ${site.EmissionsScore.toFixed(3)}
- CO2e: ${site.CO2e_tpy} tpy
- CH4: ${site.CH4_tpy} tpy
- Flood: ${site.FloodScore.toFixed(3)}
- Heat: ${site.HeatScore.toFixed(3)}
- Drought: ${site.DroughtScore.toFixed(3)}
- Location: ${site.lat.toFixed(4)}, ${site.lon.toFixed(4)}`
  )
  .join("\n")}`;
}

export async function askGemini(
  question: string,
  sites: Site[]
): Promise<string> {
  try {
    if (!process.env.NEXT_PUBLIC_GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is not set");
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const statisticalData = formatStatisticalData(sites);

    const prompt = `You are an expert climate risk and emissions analytics assistant. You have access to comprehensive analytics data about industrial sites and their climate risks.

IMPORTANT FORMATTING REQUIREMENTS:
- You MUST respond ONLY in valid Markdown format
- Your response will be parsed by a Markdown renderer, so format must be perfect
- Use proper Markdown syntax for headers (#, ##), lists (-, *), bold (**text**), italic (*text*), code (\`code\`), and blockquotes (> text)
- Do NOT use any HTML tags or non-standard markdown
- Keep your response concise and actionable
- Focus on insights, trends, and recommendations based on the data

${statisticalData}

USER QUESTION: ${question}

Please analyze the data and provide insights in well-structured Markdown format. Focus on actionable insights and recommendations based on the statistical patterns you observe.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const markdown = response.text();

    // Validate the response format
    if (!markdown || markdown.trim().length === 0) {
      throw new Error("Empty response from Gemini");
    }

    // Basic validation to ensure it looks like markdown
    if (
      !markdown.includes("#") &&
      !markdown.includes("-") &&
      !markdown.includes("**")
    ) {
      console.warn("Response may not be in proper markdown format");
    }

    return markdown;
  } catch (error) {
    console.error("Gemini API error:", error);

    // Return a fallback markdown response
    return `# Analysis Error

I apologize, but I encountered an error while analyzing your data:

> **Error**: ${error instanceof Error ? error.message : "Unknown error occurred"}

## Suggested Actions

- Check your internet connection
- Verify API key configuration
- Try your question again in a moment

For immediate assistance, please review the dashboard metrics manually or contact support.`;
  }
}

// Function to validate if text is proper markdown (basic check)
export function validateMarkdown(text: string): boolean {
  // Basic checks for markdown elements
  const hasHeaders = /^#{1,6}\s+/m.test(text);
  const hasLists = /^[\s]*[-*+]\s+/m.test(text);
  const hasBold = /\*\*[^*]+\*\*/.test(text);
  const hasItalic = /\*[^*]+\*/.test(text);
  const hasBlockquotes = /^>\s+/m.test(text);

  // At least one markdown element should be present
  return hasHeaders || hasLists || hasBold || hasItalic || hasBlockquotes;
}

// ---------------- AI Optimization Plan (JSON) ----------------

const OptimizationPickSchema = z.object({
  id: z.string(),
  cost: z.number().nonnegative(),
  benefit: z.number().min(0),
});

export const OptimizationPlanSchema = z.object({
  picks: z.array(OptimizationPickSchema).default([]),
  totalGain: z.number().min(0),
  remainingBudget: z.number().min(0),
});

export type OptimizationPlan = z.infer<typeof OptimizationPlanSchema>;

// Uses Gemini to propose an optimization plan when the backend returns empty.
export async function generateOptimizationPlan(
  sites: Site[],
  budget: number
): Promise<OptimizationPlan> {
  if (!process.env.NEXT_PUBLIC_GEMINI_API_KEY) {
    // Fallback empty plan
    return { picks: [], totalGain: 0, remainingBudget: budget > 0 ? budget : 0 };
  }

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
    });

    const compactSites = sites.slice(0, 100).map((s) => ({
      id: s.id,
      name: s.name,
      CO2e_tpy: s.CO2e_tpy,
      CH4_tpy: s.CH4_tpy,
      EmissionsScore: s.EmissionsScore,
      Risk: s.Risk,
      FloodScore: s.FloodScore,
      HeatScore: s.HeatScore,
      DroughtScore: s.DroughtScore,
    }));

    const prompt = `You are a climate risk optimization assistant.
You will receive a portfolio of sites (with emissions and risk scores) and a dollar budget.
Propose up to 10 mitigation investments that fit within the budget and maximize portfolio risk reduction.

Rules:
- Each pick must have: {"id": string, "cost": number (USD), "benefit": number (risk reduction 0-1 scale)}
- Sum of all "cost" must be <= budget.
- totalGain = sum of benefits (cap at 1.0 if it exceeds 1.0).
- remainingBudget = budget - sum(cost), min 0.
- IDs should be meaningful (e.g., site id or name with action), unique, and concise.
- If no sites provided, create generic but plausible mitigation picks.
- Return STRICT JSON ONLY that matches this TypeScript type:
  {"picks": {"id": string, "cost": number, "benefit": number}[], "totalGain": number, "remainingBudget": number}

Input:
- Budget: ${Math.max(0, Math.floor(budget))}
- Sites: ${JSON.stringify(compactSites)}
`;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    });
    const text = result.response.text();

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error("Gemini did not return valid JSON");
    }

    const plan = OptimizationPlanSchema.parse(json);

    // Normalize/guardrails
    const picks = (plan.picks || []).filter((p) => Number.isFinite(p.cost) && Number.isFinite(p.benefit));
    const spent = picks.reduce((s, p) => s + Math.max(0, p.cost), 0);
    const totalGain = Math.max(0, Math.min(1, picks.reduce((s, p) => s + Math.max(0, p.benefit), 0)));
    const remainingBudget = Math.max(0, Math.floor((budget || 0) - spent));

    return { picks, totalGain, remainingBudget };
  } catch (error) {
    console.error("Gemini plan error:", error);
    return { picks: [], totalGain: 0, remainingBudget: budget > 0 ? budget : 0 };
  }
}
