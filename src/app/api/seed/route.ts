import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  adCreatives,
  campaignBudgets,
  campaignPerformance,
  chatMessages,
  chatSessions,
  clients,
  reports,
} from "@/lib/db/schema";
import { keysToCamel } from "@/lib/db/case";
import { generateGoogleAdsData } from "@/lib/mock-data/google-ads";
import { generateMetaAdsData } from "@/lib/mock-data/meta-ads";
import { generateTikTokAdsData } from "@/lib/mock-data/tiktok-ads";
import { normalizeGoogleAds } from "@/lib/adapters/google-adapter";
import { normalizeMetaAds } from "@/lib/adapters/meta-adapter";
import { normalizeTikTokAds } from "@/lib/adapters/tiktok-adapter";
import { generateCreatives } from "@/lib/mock-data/creatives";
import type { CampaignPerformanceInsert, Platform } from "@/lib/types/database";

const CLIENTS = [
  { name: "Zenith Apparel", industry: "Fashion & Retail" },
  { name: "NovaTech Solutions", industry: "SaaS & Technology" },
  { name: "GreenLeaf Wellness", industry: "Health & Wellness" },
];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const forceReseed = (body as { force?: boolean }).force === true;

    const existingClients = await db.select({ id: clients.id }).from(clients).limit(1);

    if (existingClients.length > 0 && !forceReseed) {
      return NextResponse.json(
        { message: "Database already seeded", seeded: false },
        { status: 200 }
      );
    }

    if (forceReseed) {
      await db.delete(adCreatives);
      await db.delete(campaignBudgets);
      await db.delete(campaignPerformance);
      await db.delete(chatMessages);
      await db.delete(chatSessions);
      await db.delete(reports);
      await db.delete(clients);
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 6);

    const insertedClients = await db.insert(clients).values(CLIENTS).returning();

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
        await db
          .insert(campaignPerformance)
          .values(
            batch.map((r) => keysToCamel(r) as typeof campaignPerformance.$inferInsert)
          );
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
        await db
          .insert(campaignBudgets)
          .values(batch.map((r) => keysToCamel(r) as typeof campaignBudgets.$inferInsert));
      }

      const uniqueCampaigns = new Map<string, { campaign_id: string; campaign_name: string; platform: Platform }>();
      for (const row of normalized) {
        if (!uniqueCampaigns.has(row.campaign_id)) {
          uniqueCampaigns.set(row.campaign_id, {
            campaign_id: row.campaign_id,
            campaign_name: row.campaign_name,
            platform: row.platform,
          });
        }
      }

      const clientIndustry = CLIENTS.find(c => c.name === client.name)?.industry || "SaaS & Technology";
      const creativeRecords = generateCreatives(
        Array.from(uniqueCampaigns.values()),
        client.id,
        clientIndustry,
        endDate,
      );

      const CREATIVE_BATCH = 500;
      for (let i = 0; i < creativeRecords.length; i += CREATIVE_BATCH) {
        const batch = creativeRecords.slice(i, i + CREATIVE_BATCH);
        await db
          .insert(adCreatives)
          .values(batch.map((r) => keysToCamel(r) as typeof adCreatives.$inferInsert));
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
