import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateGoogleAdsData } from "@/lib/mock-data/google-ads";
import { generateMetaAdsData } from "@/lib/mock-data/meta-ads";
import { generateTikTokAdsData } from "@/lib/mock-data/tiktok-ads";
import { normalizeGoogleAds } from "@/lib/adapters/google-adapter";
import { normalizeMetaAds } from "@/lib/adapters/meta-adapter";
import { normalizeTikTokAds } from "@/lib/adapters/tiktok-adapter";
import type { CampaignPerformanceInsert } from "@/lib/types/database";

const CLIENTS = [
  { name: "Zenith Apparel", industry: "Fashion & Retail" },
  { name: "NovaTech Solutions", industry: "SaaS & Technology" },
  { name: "GreenLeaf Wellness", industry: "Health & Wellness" },
];

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createAdminClient();

    const body = await request.json().catch(() => ({}));
    const forceReseed = (body as { force?: boolean }).force === true;

    const { data: existingClients } = await supabase
      .from("clients")
      .select("id")
      .limit(1);

    if (existingClients && existingClients.length > 0 && !forceReseed) {
      return NextResponse.json(
        { message: "Database already seeded", seeded: false },
        { status: 200 }
      );
    }

    if (forceReseed) {
      await supabase.from("campaign_budgets").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("campaign_performance").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("chat_messages").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("chat_sessions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("reports").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("clients").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 6);

    const { data: insertedClients, error: clientError } = await supabase
      .from("clients")
      .insert(CLIENTS)
      .select();

    if (clientError) {
      throw new Error(`Failed to insert clients: ${clientError.message}`);
    }

    let totalRows = 0;

    for (const client of insertedClients) {
      const googleRaw = generateGoogleAdsData(startDate, endDate);
      const metaRaw = generateMetaAdsData(startDate, endDate);
      const tiktokRaw = generateTikTokAdsData(startDate, endDate);

      const normalized: CampaignPerformanceInsert[] = [
        ...normalizeGoogleAds(googleRaw, client.id),
        ...normalizeMetaAds(metaRaw, client.id),
        ...normalizeTikTokAds(tiktokRaw, client.id),
      ];

      const BATCH_SIZE = 500;
      for (let i = 0; i < normalized.length; i += BATCH_SIZE) {
        const batch = normalized.slice(i, i + BATCH_SIZE);
        const { error } = await supabase
          .from("campaign_performance")
          .insert(batch);

        if (error) {
          throw new Error(
            `Failed to insert batch for ${client.name}: ${error.message}`
          );
        }
      }

      totalRows += normalized.length;

      const campaignSpendMap = new Map<string, number[]>();
      for (const row of normalized) {
        const spends = campaignSpendMap.get(row.campaign_id) || [];
        spends.push(row.spend);
        campaignSpendMap.set(row.campaign_id, spends);
      }

      const budgetRecords: Array<{
        client_id: string;
        campaign_id: string;
        monthly_budget: number;
        month: string;
      }> = [];

      const months = new Set<string>();
      for (const row of normalized) {
        months.add(row.date.substring(0, 7));
      }

      for (const campaignId of campaignSpendMap.keys()) {
        const spends = campaignSpendMap.get(campaignId)!;
        const avgDailySpend = spends.reduce((a, b) => a + b, 0) / spends.length;
        const baseMonthlyBudget = avgDailySpend * 30;

        for (const month of months) {
          const variance = 0.9 + Math.random() * 0.3;
          budgetRecords.push({
            client_id: client.id,
            campaign_id: campaignId,
            monthly_budget: Number((baseMonthlyBudget * variance).toFixed(2)),
            month,
          });
        }
      }

      const BUDGET_BATCH = 500;
      for (let i = 0; i < budgetRecords.length; i += BUDGET_BATCH) {
        const batch = budgetRecords.slice(i, i + BUDGET_BATCH);
        await supabase.from("campaign_budgets").insert(batch);
      }
    }

    return NextResponse.json({
      message: "Database seeded successfully",
      seeded: true,
      clients: insertedClients.length,
      totalRows,
      dateRange: { start: startDate.toISOString(), end: endDate.toISOString() },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error during seeding";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
