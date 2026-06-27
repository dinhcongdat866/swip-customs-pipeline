import { NextResponse } from "next/server";
import { classifyWithClaude } from "@/pipeline/classify";
import { assess, lineValueUsd } from "@/pipeline/assess";
import { route } from "@/pipeline/route";
import { normalizeTitle } from "@/pipeline/normalize";
import { FX_TO_USD } from "@/pipeline/reference";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // the Anthropic call can take ~10s

/**
 * Live playground: run the real classify → assess → route steps on ONE product,
 * using an Anthropic key supplied per-request from the UI. Nothing is persisted
 * and the key is never stored — it's used for this single call only. This lets
 * the deployed demo show the AI working live without a server-side key or DB.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const { apiKey, rawTitle, rawDescription, material, declaredValue, currency, originCountry, destinationCountry, quantity } = body;

  if (!apiKey) return NextResponse.json({ error: "Anthropic API key is required" }, { status: 400 });
  if (!rawTitle) return NextResponse.json({ error: "Product title is required" }, { status: 400 });

  try {
    const classification = await classifyWithClaude({ rawTitle, rawDescription, material }, apiKey);

    const qty = Number(quantity) || 1;
    const perUnitUsd = Number(declaredValue ?? 0) * (FX_TO_USD[currency ?? "USD"] ?? 1);
    const assessment = assess({
      hsCode: classification.hsCode, declaredValueUsd: perUnitUsd, quantity: qty, destinationCountry: destinationCountry ?? null,
    });
    const lineUsd = lineValueUsd(Number(declaredValue ?? 0), currency ?? "USD", qty);
    const decision = route({ confidence: classification.confidence, complianceFlags: assessment.complianceFlags, lineValueUsd: lineUsd });

    return NextResponse.json({
      normalized: normalizeTitle(rawTitle),
      classification,
      assessment,
      decision,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "classification failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
