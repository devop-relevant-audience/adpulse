import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCreatives } from "@/lib/data/queries";
import type { Platform, CreativeType, AdCreativeRow } from "@/lib/types/database";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

const requestSchema = z.object({
  clientId: z.string().uuid(),
  count: z.number().int().min(1).max(12).default(6),
  platforms: z.array(z.enum(["google", "meta", "tiktok"])).optional(),
});

interface GeneratedCreative {
  headline: string;
  body_copy: string;
  creative_type: CreativeType;
  platform: Platform;
  rationale: string;
  thumbnail_url: string;
  inspired_by: string[];
}

const PLATFORM_COLORS: Record<Platform, { bg: string; fg: string }[]> = {
  google: [
    { bg: "E3F2FD", fg: "1565C0" },
    { bg: "E8F5E9", fg: "2E7D32" },
    { bg: "FFF8E1", fg: "F57F17" },
    { bg: "F3E5F5", fg: "6A1B9A" },
  ],
  meta: [
    { bg: "E8EAF6", fg: "283593" },
    { bg: "FCE4EC", fg: "AD1457" },
    { bg: "E0F7FA", fg: "00695C" },
    { bg: "FFF3E0", fg: "E65100" },
  ],
  tiktok: [
    { bg: "212121", fg: "FFFFFF" },
    { bg: "1A1A2E", fg: "E94560" },
    { bg: "0F3460", fg: "00D2FF" },
    { bg: "2D132C", fg: "EE4540" },
  ],
};

function buildThumbnailUrl(
  headline: string,
  type: CreativeType,
  platform: Platform,
  index: number,
): string {
  const colors = PLATFORM_COLORS[platform];
  const color = colors[index % colors.length];
  const dims = type === "video" ? "640x360" : type === "carousel" ? "400x400" : "400x300";
  const text = encodeURIComponent(headline.slice(0, 40));
  return `https://placehold.co/${dims}/${color.bg}/${color.fg}?text=${text}`;
}

function summarizeTopPerformers(creatives: AdCreativeRow[]): string {
  return creatives
    .map(
      (c, i) =>
        `${i + 1}. "${c.headline}" — ${c.creative_type} on ${c.platform}\n` +
        `   Copy: "${c.body_copy}"\n` +
        `   CTR: ${(Number(c.ctr) * 100).toFixed(2)}%, CPA: $${Number(c.cpa).toFixed(2)}, ` +
        `Conversions: ${c.conversions}, Spend: $${Number(c.spend).toFixed(0)}`,
    )
    .join("\n\n");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { clientId, count, platforms } = parsed.data;

    const allCreatives = await getCreatives({
      clientId,
      sort: "ctr",
      order: "desc",
    });

    if (allCreatives.length === 0) {
      return NextResponse.json(
        { error: "No creatives found for this client. Seed data first." },
        { status: 404 },
      );
    }

    const topPerformers = allCreatives
      .filter((c) => c.status === "active")
      .sort((a, b) => {
        const scoreA = Number(a.ctr) * 1000 + Number(a.conversions) / Math.max(Number(a.cpa), 1);
        const scoreB = Number(b.ctr) * 1000 + Number(b.conversions) / Math.max(Number(b.cpa), 1);
        return scoreB - scoreA;
      })
      .slice(0, 8);

    if (topPerformers.length === 0) {
      return NextResponse.json(
        { error: "No active creatives to base variants on." },
        { status: 404 },
      );
    }

    const platformSet = platforms?.length
      ? platforms
      : [...new Set(topPerformers.map((c) => c.platform))];

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(generateFallbackVariants(topPerformers, count, platformSet));
    }

    const prompt = `You are an expert ad creative strategist. Analyze these top-performing ad creatives and generate ${count} new creative variants that combine the best elements (headlines, copy angles, formats, tones) from the winners.

TOP PERFORMING CREATIVES:
${summarizeTopPerformers(topPerformers)}

REQUIREMENTS:
- Generate exactly ${count} new creative variants
- Each variant should combine successful elements from multiple top performers
- Mix and match: try new headline + body copy combinations, adapt winning copy angles to different formats
- Target these platforms: ${platformSet.join(", ")}
- creative_type must be one of: "image", "video", "carousel"
- platform must be one of: ${platformSet.map((p) => `"${p}"`).join(", ")}
- For each variant, explain which top performers inspired it and why
- Make copy compelling, specific, and action-oriented
- Vary the creative types across variants

Respond ONLY with valid JSON in this exact format (no markdown, no code fences):
{
  "variants": [
    {
      "headline": "string (max 50 chars)",
      "body_copy": "string (max 120 chars)",
      "creative_type": "image" | "video" | "carousel",
      "platform": "${platformSet[0]}",
      "rationale": "string explaining the creative strategy",
      "inspired_by": ["headline of source creative 1", "headline of source creative 2"]
    }
  ]
}`;

    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://adpulse.app",
        "X-Title": "AdPulse",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a JSON-only API. Respond with valid JSON only, no markdown formatting, no code fences, no explanations outside the JSON.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.8,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      console.error("OpenRouter error:", await response.text());
      return NextResponse.json(generateFallbackVariants(topPerformers, count, platformSet));
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json(generateFallbackVariants(topPerformers, count, platformSet));
    }

    let aiVariants: { variants: Array<Omit<GeneratedCreative, "thumbnail_url">> };
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      aiVariants = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI response:", content);
      return NextResponse.json(generateFallbackVariants(topPerformers, count, platformSet));
    }

    const variants: GeneratedCreative[] = (aiVariants.variants || [])
      .slice(0, count)
      .map((v, i) => ({
        headline: v.headline || "New Variant",
        body_copy: v.body_copy || "Generated creative variant",
        creative_type: (["image", "video", "carousel"].includes(v.creative_type)
          ? v.creative_type
          : "image") as CreativeType,
        platform: (platformSet.includes(v.platform as Platform)
          ? v.platform
          : platformSet[0]) as Platform,
        rationale: v.rationale || "",
        inspired_by: v.inspired_by || [],
        thumbnail_url: buildThumbnailUrl(
          v.headline || "New Variant",
          (v.creative_type || "image") as CreativeType,
          (v.platform || platformSet[0]) as Platform,
          i,
        ),
      }));

    return NextResponse.json({
      variants,
      topPerformers: topPerformers.map((c) => ({
        headline: c.headline,
        creative_type: c.creative_type,
        platform: c.platform,
        ctr: c.ctr,
        cpa: c.cpa,
        conversions: c.conversions,
      })),
      generatedWith: "ai",
    });
  } catch (error) {
    console.error("Creative generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate creatives" },
      { status: 500 },
    );
  }
}

function generateFallbackVariants(
  topPerformers: AdCreativeRow[],
  count: number,
  platforms: (string | Platform)[],
): {
  variants: GeneratedCreative[];
  topPerformers: Array<{
    headline: string;
    creative_type: string;
    platform: string;
    ctr: number;
    cpa: number;
    conversions: number;
  }>;
  generatedWith: string;
} {
  const types: CreativeType[] = ["image", "video", "carousel"];
  const variants: GeneratedCreative[] = [];

  for (let i = 0; i < Math.min(count, 12); i++) {
    const sourceA = topPerformers[i % topPerformers.length];
    const sourceB = topPerformers[(i + 1) % topPerformers.length];

    const headline = remixHeadline(sourceA.headline, sourceB.headline, i);
    const bodyCopy = remixBody(sourceA.body_copy, sourceB.body_copy, i);
    const creativeType = types[i % types.length];
    const platform = platforms[i % platforms.length] as Platform;

    variants.push({
      headline,
      body_copy: bodyCopy,
      creative_type: creativeType,
      platform,
      rationale: `Combines the angle from "${sourceA.headline}" with elements of "${sourceB.headline}"`,
      inspired_by: [sourceA.headline, sourceB.headline],
      thumbnail_url: buildThumbnailUrl(headline, creativeType, platform, i),
    });
  }

  return {
    variants,
    topPerformers: topPerformers.map((c) => ({
      headline: c.headline,
      creative_type: c.creative_type,
      platform: c.platform,
      ctr: c.ctr,
      cpa: c.cpa,
      conversions: c.conversions,
    })),
    generatedWith: "fallback",
  };
}

function remixHeadline(a: string, b: string, index: number): string {
  const prefixes = ["New:", "Try:", "Discover:", "Unlock:", "Exclusive:", "Fresh:"];
  const prefix = prefixes[index % prefixes.length];
  const wordsA = a.split(" ").slice(0, 3).join(" ");
  const wordsB = b.split(" ").slice(-2).join(" ");
  return `${prefix} ${wordsA} ${wordsB}`.slice(0, 50);
}

function remixBody(a: string, b: string, index: number): string {
  const sentencesA = a.split(". ");
  const sentencesB = b.split(". ");
  if (index % 2 === 0 && sentencesA.length > 1 && sentencesB.length > 0) {
    return `${sentencesA[0]}. ${sentencesB[sentencesB.length - 1]}`;
  }
  return `${sentencesB[0]}. ${sentencesA[sentencesA.length - 1]}`;
}
