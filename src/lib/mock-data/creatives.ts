import { format, subDays } from "date-fns";
import { randomBetween, randomInt, round } from "./helpers";
import type { AdCreativeInsert, Platform, CreativeType, CreativeStatus } from "@/lib/types/database";

interface CampaignInfo {
  campaign_id: string;
  campaign_name: string;
  platform: Platform;
}

type PerformanceTier = "top" | "fatiguing" | "underperformer" | "new";

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

interface CreativeCopy {
  headline: string;
  body: string;
  type: CreativeType;
}

const CREATIVE_CATALOG: Record<string, CreativeCopy[]> = {
  "Fashion & Retail": [
    { headline: "Summer Sale - 30% Off", body: "Shop the latest summer styles. Limited time offer on all collections.", type: "image" },
    { headline: "New Arrivals Drop", body: "Fresh looks just landed. Be the first to shop our new collection.", type: "image" },
    { headline: "Style Your Way", body: "Mix and match your perfect outfit. Free shipping on orders $50+.", type: "carousel" },
    { headline: "Flash Sale Today", body: "24 hours only. Up to 50% off select items. Don't miss out!", type: "image" },
    { headline: "Trending Now", body: "See what everyone is wearing this season. Curated picks for you.", type: "video" },
    { headline: "VIP Early Access", body: "Members get first dibs on new drops. Join for exclusive perks.", type: "image" },
    { headline: "Weekend Wardrobe", body: "Casual essentials starting at $19. Dress up or down all weekend.", type: "carousel" },
    { headline: "Bundle & Save", body: "Buy 2 get 1 free on all accessories. Stock up on must-haves.", type: "image" },
    { headline: "Lookbook 2026", body: "Watch our latest campaign video. Inspired by summer in the city.", type: "video" },
    { headline: "Last Chance Clearance", body: "Final markdowns on past seasons. Once it's gone, it's gone.", type: "image" },
  ],
  "SaaS & Technology": [
    { headline: "Try Free for 14 Days", body: "No credit card required. See why 10K+ teams switched to us.", type: "image" },
    { headline: "Automate Your Workflow", body: "Save 10 hours/week with smart automation. Set up in minutes.", type: "video" },
    { headline: "See the Demo", body: "Watch how our platform transforms your data into actionable insights.", type: "video" },
    { headline: "Enterprise Ready", body: "SOC2 certified. SSO, SAML, and audit logs included on all plans.", type: "image" },
    { headline: "Compare Plans", body: "From startup to enterprise, find the plan that fits your team.", type: "carousel" },
    { headline: "Customer Story", body: "How Acme Corp reduced churn by 40% using our analytics suite.", type: "video" },
    { headline: "New Feature Launch", body: "AI-powered insights are here. Get smarter recommendations today.", type: "image" },
    { headline: "Integrate Everything", body: "Connect 200+ tools in one click. Slack, Jira, Salesforce & more.", type: "carousel" },
    { headline: "ROI Calculator", body: "See how much you could save. Calculate your return in 30 seconds.", type: "image" },
    { headline: "Webinar This Week", body: "Join us live: Best practices for scaling your analytics stack.", type: "image" },
  ],
  "Health & Wellness": [
    { headline: "Feel Your Best", body: "Clinically-tested supplements for energy, focus, and recovery.", type: "image" },
    { headline: "Start Your Journey", body: "Personalized wellness plans tailored to your goals. Take the quiz.", type: "carousel" },
    { headline: "Member Transformations", body: "Real results from real people. See their 90-day progress.", type: "video" },
    { headline: "Subscribe & Save 20%", body: "Never run out. Monthly delivery with flexible scheduling.", type: "image" },
    { headline: "Doctor Approved", body: "Formulated by physicians. Backed by 15+ clinical studies.", type: "image" },
    { headline: "New: Sleep Formula", body: "Fall asleep faster, wake refreshed. Non-habit forming ingredients.", type: "image" },
    { headline: "Wellness Routine", body: "Watch how to build your daily supplement stack in 3 easy steps.", type: "video" },
    { headline: "Family Bundle", body: "Health for the whole family. Kids, teens, and adult formulas.", type: "carousel" },
    { headline: "Limited Edition Flavor", body: "Tropical Mango protein is here for summer. Get it before it's gone.", type: "image" },
    { headline: "Free Shipping Over $35", body: "Stock up on essentials. Fast, free delivery on qualifying orders.", type: "image" },
  ],
};

function buildThumbnailUrl(
  headline: string,
  type: CreativeType,
  platform: Platform,
  colorIndex: number,
): string {
  const colors = PLATFORM_COLORS[platform];
  const color = colors[colorIndex % colors.length];
  const dims = type === "video" ? "640x360" : type === "carousel" ? "400x400" : "400x300";
  const text = encodeURIComponent(headline);
  return `https://placehold.co/${dims}/${color.bg}/${color.fg}?text=${text}`;
}

function assignTier(index: number, total: number): PerformanceTier {
  const ratio = index / total;
  if (ratio < 0.25) return "top";
  if (ratio < 0.5) return "fatiguing";
  if (ratio < 0.8) return "underperformer";
  return "new";
}

function generateMetricsForTier(
  tier: PerformanceTier,
  endDate: Date,
): {
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  ctr: number;
  cpc: number;
  cpa: number;
  first_served: string;
  last_served: string;
  days_running: number;
  status: CreativeStatus;
} {
  const lastServed = format(subDays(endDate, randomInt(0, 5)), "yyyy-MM-dd");

  switch (tier) {
    case "top": {
      const daysRunning = randomInt(20, 90);
      const firstServed = format(subDays(endDate, daysRunning), "yyyy-MM-dd");
      const impressions = randomInt(80000, 300000);
      const ctr = round(randomBetween(0.03, 0.055), 4);
      const clicks = Math.round(impressions * ctr);
      const cpc = round(randomBetween(0.25, 0.80), 4);
      const spend = round(clicks * cpc, 2);
      const convRate = randomBetween(0.03, 0.06);
      const conversions = Math.max(1, Math.round(clicks * convRate));
      const cpa = round(spend / conversions, 2);
      return { impressions, clicks, spend, conversions, ctr, cpc, cpa, first_served: firstServed, last_served: lastServed, days_running: daysRunning, status: "active" };
    }
    case "fatiguing": {
      const daysRunning = randomInt(45, 120);
      const firstServed = format(subDays(endDate, daysRunning), "yyyy-MM-dd");
      const impressions = randomInt(120000, 400000);
      const ctr = round(randomBetween(0.008, 0.018), 4);
      const clicks = Math.round(impressions * ctr);
      const cpc = round(randomBetween(0.90, 2.20), 4);
      const spend = round(clicks * cpc, 2);
      const convRate = randomBetween(0.008, 0.02);
      const conversions = Math.max(1, Math.round(clicks * convRate));
      const cpa = round(spend / conversions, 2);
      return { impressions, clicks, spend, conversions, ctr, cpc, cpa, first_served: firstServed, last_served: lastServed, days_running: daysRunning, status: "fatigued" };
    }
    case "underperformer": {
      const daysRunning = randomInt(14, 45);
      const firstServed = format(subDays(endDate, daysRunning), "yyyy-MM-dd");
      const impressions = randomInt(30000, 80000);
      const ctr = round(randomBetween(0.003, 0.009), 4);
      const clicks = Math.round(impressions * ctr);
      const cpc = round(randomBetween(1.50, 3.50), 4);
      const spend = round(clicks * cpc, 2);
      const convRate = randomBetween(0.004, 0.012);
      const conversions = Math.max(1, Math.round(clicks * convRate));
      const cpa = round(spend / conversions, 2);
      return { impressions, clicks, spend, conversions, ctr, cpc, cpa, first_served: firstServed, last_served: lastServed, days_running: daysRunning, status: "paused" };
    }
    case "new": {
      const daysRunning = randomInt(1, 7);
      const firstServed = format(subDays(endDate, daysRunning), "yyyy-MM-dd");
      const impressions = randomInt(1000, 8000);
      const ctr = round(randomBetween(0.015, 0.035), 4);
      const clicks = Math.round(impressions * ctr);
      const cpc = round(randomBetween(0.40, 1.20), 4);
      const spend = round(clicks * cpc, 2);
      const convRate = randomBetween(0.01, 0.04);
      const conversions = Math.max(0, Math.round(clicks * convRate));
      const cpa = conversions > 0 ? round(spend / conversions, 2) : 0;
      return { impressions, clicks, spend, conversions, ctr, cpc, cpa, first_served: firstServed, last_served: lastServed, days_running: daysRunning, status: "active" };
    }
  }
}

export function generateCreatives(
  campaigns: CampaignInfo[],
  clientId: string,
  industry: string,
  endDate: Date,
): AdCreativeInsert[] {
  const catalog = CREATIVE_CATALOG[industry] || CREATIVE_CATALOG["SaaS & Technology"];
  const creatives: AdCreativeInsert[] = [];

  for (const campaign of campaigns) {
    const count = randomInt(8, 12);
    const shuffled = [...catalog].sort(() => Math.random() - 0.5).slice(0, count);

    for (let i = 0; i < shuffled.length; i++) {
      const copy = shuffled[i];
      const tier = assignTier(i, shuffled.length);
      const metrics = generateMetricsForTier(tier, endDate);

      const adId = `${campaign.campaign_id}-ad-${String(i + 1).padStart(3, "0")}`;
      const adName = `${copy.headline} (${copy.type})`;

      creatives.push({
        client_id: clientId,
        campaign_id: campaign.campaign_id,
        platform: campaign.platform,
        ad_id: adId,
        ad_name: adName,
        creative_type: copy.type,
        headline: copy.headline,
        body_copy: copy.body,
        thumbnail_url: buildThumbnailUrl(copy.headline, copy.type, campaign.platform, i),
        ...metrics,
      });
    }
  }

  return creatives;
}
