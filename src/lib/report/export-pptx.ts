import PptxGenJS from "pptxgenjs";
import type { ReportData } from "./builder";

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

const C = {
  primary: "2563EB",
  dark: "1A1A1A",
  muted: "615D59",
  faint: "A39E98",
  bg: "F8F7F6",
  white: "FFFFFF",
  border: "E8E8E8",
  green: "16A34A",
  greenBg: "F0FDF4",
  red: "DC2626",
  redBg: "FEF2F2",
  blue: "2563EB",
  blueBg: "EFF6FF",
  amber: "D97706",
  amberBg: "FFFBEB",
  violet: "8B5CF6",
  violetBg: "F5F3FF",
  pink: "EC4899",
  teal: "0EA5E9",
};

const FONT = "Inter, Arial";
const PLATFORM_LABELS: Record<string, string> = { google: "Google Ads", meta: "Meta Ads", tiktok: "TikTok Ads" };
const PLATFORM_COLORS: Record<string, string> = { google: "4285F4", meta: "0668E1", tiktok: "FE2C55" };

function scoreColor(score: number): string {
  if (score >= 80) return C.green;
  if (score >= 60) return C.blue;
  if (score >= 40) return C.amber;
  return C.red;
}

function addFooter(slide: PptxGenJS.Slide) {
  slide.addText("AdPulse", {
    x: 0.4, y: 5.15, w: 2, h: 0.3,
    fontSize: 8, color: C.faint, fontFace: FONT,
  });
}

function addSlideTitle(slide: PptxGenJS.Slide, title: string, iconColor: string, subtitle?: string) {
  slide.addShape("roundRect" as PptxGenJS.ShapeType, {
    x: 0.4, y: 0.3, w: 0.32, h: 0.32,
    fill: { color: iconColor }, rectRadius: 0.04,
  });
  slide.addText(title, {
    x: 0.85, y: 0.25, w: 8.5, h: 0.4,
    fontSize: 18, bold: true, color: C.dark, fontFace: FONT,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.85, y: 0.6, w: 8.5, h: 0.3,
      fontSize: 9, color: C.muted, fontFace: FONT,
    });
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}

export async function exportPptx(data: ReportData): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.author = "AdPulse";
  pptx.title = `${data.clientName} \u2014 Performance Report`;
  pptx.subject = `${data.dateRange.start} to ${data.dateRange.end}`;
  pptx.layout = "LAYOUT_WIDE";

  const c = data.comparison.current;
  const d = data.comparison.deltas;

  // ── Slide 1: Title ──
  const s1 = pptx.addSlide();
  s1.background = { color: C.dark };
  s1.addShape("roundRect" as PptxGenJS.ShapeType, {
    x: 0, y: 0, w: 13.33, h: 5.63,
    fill: { color: C.dark },
  });
  s1.addShape("roundRect" as PptxGenJS.ShapeType, {
    x: 0.6, y: 1.8, w: 0.06, h: 2.0,
    fill: { color: C.primary }, rectRadius: 0.02,
  });
  s1.addText(data.clientName, {
    x: 1.0, y: 1.5, w: 10, h: 0.9,
    fontSize: 36, bold: true, color: C.white, fontFace: FONT,
  });
  s1.addText("Performance Report", {
    x: 1.0, y: 2.3, w: 10, h: 0.6,
    fontSize: 18, color: "808080", fontFace: FONT,
  });
  s1.addText(`${data.dateRange.start}  \u2014  ${data.dateRange.end}`, {
    x: 1.0, y: 3.0, w: 10, h: 0.4,
    fontSize: 12, color: "666666", fontFace: FONT,
  });
  s1.addText(`Generated ${new Date(data.generatedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`, {
    x: 1.0, y: 4.6, w: 10, h: 0.3,
    fontSize: 9, color: "555555", fontFace: FONT,
  });

  // ── Slide 2: Executive Summary ──
  const s2 = pptx.addSlide();
  s2.background = { color: C.white };
  addSlideTitle(s2, "Executive Summary", C.violet);
  s2.addShape("roundRect" as PptxGenJS.ShapeType, {
    x: 0.4, y: 1.0, w: 12.5, h: 3.4,
    fill: { color: C.bg }, rectRadius: 0.08,
  });
  s2.addText(truncate(data.narratives.executive, 600), {
    x: 0.7, y: 1.2, w: 12, h: 3.0,
    fontSize: 12, color: C.muted, fontFace: FONT,
    valign: "top", lineSpacingMultiple: 1.6, paraSpaceAfter: 6,
    shrinkText: true,
  });
  addFooter(s2);

  // ── Slide 3: KPI Overview ──
  const s3 = pptx.addSlide();
  s3.background = { color: C.white };
  addSlideTitle(s3, "KPI Overview", C.blue, `vs. ${data.comparisonRange.start} to ${data.comparisonRange.end}`);

  const kpis = [
    { label: "SPEND", value: formatCurrency(c.totalSpend), delta: d.totalSpend.percentage, invert: false },
    { label: "CONVERSIONS", value: formatNum(c.totalConversions), delta: d.totalConversions.percentage, invert: false },
    { label: "CPA", value: formatCurrency(c.avgCpa), delta: d.avgCpa.percentage, invert: true },
    { label: "CTR", value: `${c.avgCtr}%`, delta: d.avgCtr.percentage, invert: false },
  ];
  const kpis2 = [
    { label: "CLICKS", value: formatNum(c.totalClicks), delta: d.totalClicks.percentage, invert: false },
    { label: "IMPRESSIONS", value: formatNum(c.totalImpressions), delta: d.totalImpressions.percentage, invert: false },
    { label: "CPC", value: formatCurrency(c.avgCpc), delta: d.avgCpc.percentage, invert: true },
    { label: "CPM", value: formatCurrency(c.avgCpm), delta: d.avgCpm.percentage, invert: true },
  ];

  kpis.forEach((kpi, i) => {
    const x = 0.4 + i * 3.15;
    s3.addShape("roundRect" as PptxGenJS.ShapeType, {
      x, y: 1.1, w: 2.9, h: 1.6,
      fill: { color: C.white },
      line: { color: C.border, width: 1 },
      rectRadius: 0.06,
    });
    s3.addText(kpi.label, {
      x, y: 1.25, w: 2.9, h: 0.3,
      fontSize: 8, bold: true, color: C.muted, fontFace: FONT, align: "center",
    });
    s3.addText(kpi.value, {
      x, y: 1.6, w: 2.9, h: 0.5,
      fontSize: 22, bold: true, color: C.dark, fontFace: FONT, align: "center",
    });
    const isGood = kpi.invert ? kpi.delta < 0 : kpi.delta >= 0;
    s3.addText(`${kpi.delta >= 0 ? "\u25B2 +" : "\u25BC "}${kpi.delta.toFixed(1)}%`, {
      x, y: 2.15, w: 2.9, h: 0.3,
      fontSize: 10, bold: true, color: isGood ? C.green : C.red, fontFace: FONT, align: "center",
    });
  });

  kpis2.forEach((kpi, i) => {
    const x = 0.4 + i * 3.15;
    s3.addShape("roundRect" as PptxGenJS.ShapeType, {
      x, y: 2.95, w: 2.9, h: 1.2,
      fill: { color: C.bg }, rectRadius: 0.06,
    });
    s3.addText(kpi.label, {
      x, y: 3.05, w: 2.9, h: 0.25,
      fontSize: 8, bold: true, color: C.muted, fontFace: FONT, align: "center",
    });
    s3.addText(kpi.value, {
      x, y: 3.35, w: 2.9, h: 0.35,
      fontSize: 14, bold: true, color: C.dark, fontFace: FONT, align: "center",
    });
    const isGood = kpi.invert ? kpi.delta < 0 : kpi.delta >= 0;
    s3.addText(`${kpi.delta >= 0 ? "+" : ""}${kpi.delta.toFixed(1)}%`, {
      x, y: 3.75, w: 2.9, h: 0.25,
      fontSize: 9, bold: true, color: isGood ? C.green : C.red, fontFace: FONT, align: "center",
    });
  });
  addFooter(s3);

  // ── Slide 4: Trends ──
  const s4 = pptx.addSlide();
  s4.background = { color: C.white };
  addSlideTitle(s4, "Performance Trends", C.violet);
  s4.addText(truncate(data.narratives.trends, 350), {
    x: 0.4, y: 1.0, w: 12.5, h: 1.2,
    fontSize: 11, color: C.muted, fontFace: FONT, valign: "top", lineSpacingMultiple: 1.5,
    shrinkText: true,
  });

  const trendStats = [
    { label: "BEST DAY", value: data.trendSummary.bestDay.date, sub: `${data.trendSummary.bestDay.conversions} conv.`, bg: C.greenBg, color: C.green },
    { label: "WORST DAY", value: data.trendSummary.worstDay.date, sub: `${data.trendSummary.worstDay.conversions} conv.`, bg: C.redBg, color: C.red },
    { label: "AVG DAILY SPEND", value: formatCurrency(data.trendSummary.avgDailySpend), sub: "", bg: C.blueBg, color: C.blue },
    { label: "VOLATILITY", value: `${(data.trendSummary.spendVolatility * 100).toFixed(1)}%`, sub: "", bg: C.amberBg, color: C.amber },
  ];
  trendStats.forEach((ts, i) => {
    const x = 0.4 + i * 3.15;
    s4.addShape("roundRect" as PptxGenJS.ShapeType, {
      x, y: 2.5, w: 2.9, h: 1.5,
      fill: { color: ts.bg }, rectRadius: 0.06,
    });
    s4.addText(ts.label, {
      x, y: 2.6, w: 2.9, h: 0.3,
      fontSize: 8, bold: true, color: ts.color, fontFace: FONT, align: "center",
    });
    s4.addText(ts.value, {
      x, y: 3.0, w: 2.9, h: 0.4,
      fontSize: 14, bold: true, color: C.dark, fontFace: FONT, align: "center",
    });
    if (ts.sub) {
      s4.addText(ts.sub, {
        x, y: 3.45, w: 2.9, h: 0.3,
        fontSize: 10, color: ts.color, fontFace: FONT, align: "center",
      });
    }
  });
  addFooter(s4);

  // ── Slide 5: Platform Breakdown ──
  const s5 = pptx.addSlide();
  s5.background = { color: C.white };
  addSlideTitle(s5, "Platform Breakdown", C.teal);
  s5.addText(truncate(data.narratives.platforms, 250), {
    x: 0.4, y: 0.9, w: 12.5, h: 0.8,
    fontSize: 11, color: C.muted, fontFace: FONT, valign: "top", lineSpacingMultiple: 1.4,
    shrinkText: true,
  });

  const sorted = [...data.platformBreakdown].sort((a, b) => b.spend - a.spend);
  const totalSpend = sorted.reduce((s, p) => s + p.spend, 0);

  sorted.forEach((p, i) => {
    const x = 0.4 + i * (12.5 / sorted.length);
    const w = 12.5 / sorted.length - 0.15;
    const pColor = PLATFORM_COLORS[p.platform] || "888888";

    s5.addShape("roundRect" as PptxGenJS.ShapeType, {
      x, y: 1.9, w, h: 3.0,
      fill: { color: C.bg }, rectRadius: 0.06,
    });

    s5.addShape("roundRect" as PptxGenJS.ShapeType, {
      x: x + 0.15, y: 2.1, w: 0.14, h: 0.14,
      fill: { color: pColor }, rectRadius: 0.02,
    });
    s5.addText(PLATFORM_LABELS[p.platform] || p.platform, {
      x: x + 0.4, y: 2.05, w: w - 0.5, h: 0.25,
      fontSize: 11, bold: true, color: C.dark, fontFace: FONT,
    });

    const spendPct = totalSpend > 0 ? (p.spend / totalSpend * 100) : 0;
    s5.addShape("roundRect" as PptxGenJS.ShapeType, {
      x: x + 0.15, y: 2.45, w: w - 0.3, h: 0.12,
      fill: { color: C.border }, rectRadius: 0.03,
    });
    s5.addShape("roundRect" as PptxGenJS.ShapeType, {
      x: x + 0.15, y: 2.45, w: Math.max(0.1, (w - 0.3) * spendPct / 100), h: 0.12,
      fill: { color: pColor }, rectRadius: 0.03,
    });
    s5.addText(`${formatCurrency(p.spend)} (${p.pctOfSpend}%)`, {
      x: x + 0.15, y: 2.65, w: w - 0.3, h: 0.25,
      fontSize: 9, color: C.muted, fontFace: FONT,
    });

    const metrics = [
      { label: "Conversions", value: formatNum(p.conversions) },
      { label: "CTR", value: `${p.ctr}%` },
      { label: "CPA", value: formatCurrency(p.cpa) },
      { label: "CPC", value: formatCurrency(p.cpc) },
    ];
    metrics.forEach((m, mi) => {
      const my = 3.1 + mi * 0.42;
      s5.addText(m.label, {
        x: x + 0.15, y: my, w: (w - 0.3) * 0.5, h: 0.3,
        fontSize: 8, color: C.faint, fontFace: FONT, valign: "middle",
      });
      s5.addText(m.value, {
        x: x + 0.15 + (w - 0.3) * 0.5, y: my, w: (w - 0.3) * 0.5, h: 0.3,
        fontSize: 10, bold: true, color: C.dark, fontFace: FONT, align: "right", valign: "middle",
      });
    });
  });
  addFooter(s5);

  // ── Slide 6: Funnel ──
  const s6 = pptx.addSlide();
  s6.background = { color: C.white };
  addSlideTitle(s6, "Funnel Analysis", C.violet);
  s6.addText(truncate(data.narratives.funnel, 300), {
    x: 0.4, y: 0.9, w: 12.5, h: 0.9,
    fontSize: 11, color: C.muted, fontFace: FONT, valign: "top", lineSpacingMultiple: 1.4,
    shrinkText: true,
  });

  if (data.funnel.overall.length >= 2) {
    const stages = data.funnel.overall;
    const funnelColors = ["3B82F6", "8B5CF6", "10B981", "F59E0B"];
    const maxW = 11;

    stages.forEach((stage, i) => {
      const widthPct = i === 0 ? 1 : Math.max(0.15, stage.percentOfFirst / 100);
      const barW = maxW * widthPct;
      const barX = 0.8 + (maxW - barW) / 2;
      const barY = 2.1 + i * 0.8;
      const fColor = funnelColors[i % funnelColors.length];

      s6.addShape("roundRect" as PptxGenJS.ShapeType, {
        x: barX, y: barY, w: barW, h: 0.55,
        fill: { color: fColor }, rectRadius: 0.04,
      });
      s6.addText(`${stage.stage}  \u2014  ${formatNum(stage.volume)}`, {
        x: barX, y: barY, w: barW, h: 0.55,
        fontSize: 11, bold: true, color: C.white, fontFace: FONT, align: "center", valign: "middle",
      });
      if (i > 0) {
        s6.addText(`${stage.percentOfPrevious}%`, {
          x: barX + barW + 0.15, y: barY, w: 0.6, h: 0.55,
          fontSize: 9, color: C.muted, fontFace: FONT, valign: "middle",
        });
      }
    });
  }
  addFooter(s6);

  // ── Slide 7: Campaign Performance ──
  const s7 = pptx.addSlide();
  s7.background = { color: C.white };
  addSlideTitle(s7, "Top Campaigns", C.green);

  const topCampaigns = [...data.campaignBreakdown].sort((a, b) => b.conversions - a.conversions).slice(0, 8);

  topCampaigns.forEach((camp, i) => {
    const y = 0.9 + i * 0.55;
    const bgColor = i < 3 ? C.greenBg : C.bg;

    s7.addShape("roundRect" as PptxGenJS.ShapeType, {
      x: 0.4, y, w: 12.5, h: 0.45,
      fill: { color: bgColor }, rectRadius: 0.04,
    });

    if (i < 3) {
      s7.addShape("roundRect" as PptxGenJS.ShapeType, {
        x: 0.5, y: y + 0.06, w: 0.33, h: 0.33,
        fill: { color: i === 0 ? C.green : "86EFAC" }, rectRadius: 0.04,
      });
      s7.addText(`${i + 1}`, {
        x: 0.5, y: y + 0.06, w: 0.33, h: 0.33,
        fontSize: 9, bold: true, color: C.white, fontFace: FONT, align: "center", valign: "middle",
      });
    }

    const nameX = i < 3 ? 1.0 : 0.6;
    s7.addText(truncate(camp.campaignName, 35), {
      x: nameX, y, w: 5.5, h: 0.45,
      fontSize: 10, color: C.dark, fontFace: FONT, valign: "middle",
    });
    s7.addText(camp.platform, {
      x: 6.5, y, w: 1.2, h: 0.45,
      fontSize: 8, color: C.muted, fontFace: FONT, valign: "middle",
    });
    s7.addText(`${camp.conversions} conv.`, {
      x: 7.8, y, w: 1.5, h: 0.45,
      fontSize: 10, bold: true, color: C.dark, fontFace: FONT, align: "right", valign: "middle",
    });
    s7.addText(formatCurrency(camp.cpa), {
      x: 9.5, y, w: 1.2, h: 0.45,
      fontSize: 10, color: C.dark, fontFace: FONT, align: "right", valign: "middle",
    });
    s7.addText(formatCurrency(camp.spend), {
      x: 10.9, y, w: 1.5, h: 0.45,
      fontSize: 10, color: C.dark, fontFace: FONT, align: "right", valign: "middle",
    });
  });

  const headerY = 0.78;
  s7.addText("Campaign", { x: 0.6, y: headerY, w: 5, h: 0.2, fontSize: 7, bold: true, color: C.faint, fontFace: FONT });
  s7.addText("Platform", { x: 6.5, y: headerY, w: 1.2, h: 0.2, fontSize: 7, bold: true, color: C.faint, fontFace: FONT });
  s7.addText("Conv.", { x: 7.8, y: headerY, w: 1.5, h: 0.2, fontSize: 7, bold: true, color: C.faint, fontFace: FONT, align: "right" });
  s7.addText("CPA", { x: 9.5, y: headerY, w: 1.2, h: 0.2, fontSize: 7, bold: true, color: C.faint, fontFace: FONT, align: "right" });
  s7.addText("Spend", { x: 10.9, y: headerY, w: 1.5, h: 0.2, fontSize: 7, bold: true, color: C.faint, fontFace: FONT, align: "right" });
  addFooter(s7);

  // ── Slide 8: Health Score ──
  const s8 = pptx.addSlide();
  s8.background = { color: C.white };
  addSlideTitle(s8, "Account Health", C.pink);

  const gc = scoreColor(data.healthScore.overallScore);
  s8.addShape("roundRect" as PptxGenJS.ShapeType, {
    x: 0.4, y: 1.0, w: 3.0, h: 2.8,
    fill: { color: C.bg }, rectRadius: 0.08,
  });
  s8.addText(`${data.healthScore.overallScore}`, {
    x: 0.4, y: 1.2, w: 3.0, h: 1.2,
    fontSize: 48, bold: true, color: gc, fontFace: FONT, align: "center",
  });
  s8.addText(`Grade ${data.healthScore.grade}`, {
    x: 0.4, y: 2.3, w: 3.0, h: 0.4,
    fontSize: 13, bold: true, color: gc, fontFace: FONT, align: "center",
  });
  s8.addText("out of 100", {
    x: 0.4, y: 2.7, w: 3.0, h: 0.3,
    fontSize: 9, color: C.muted, fontFace: FONT, align: "center",
  });

  s8.addText(truncate(data.narratives.health, 300), {
    x: 3.7, y: 1.0, w: 9.2, h: 1.5,
    fontSize: 11, color: C.muted, fontFace: FONT, valign: "top", lineSpacingMultiple: 1.4,
    shrinkText: true,
  });

  const subScores = data.healthScore.subScores;
  const subsPerRow = 3;
  subScores.forEach((sub, i) => {
    const col = i % subsPerRow;
    const row = Math.floor(i / subsPerRow);
    const sx = 3.7 + col * 3.1;
    const sy = 2.7 + row * 1.0;

    s8.addShape("roundRect" as PptxGenJS.ShapeType, {
      x: sx, y: sy, w: 2.9, h: 0.85,
      fill: { color: C.bg }, rectRadius: 0.04,
    });
    s8.addText(sub.name, {
      x: sx + 0.1, y: sy + 0.08, w: 2.0, h: 0.2,
      fontSize: 9, bold: true, color: C.dark, fontFace: FONT,
    });
    s8.addText(`${sub.score.toFixed(0)}`, {
      x: sx + 2.0, y: sy + 0.05, w: 0.8, h: 0.25,
      fontSize: 10, bold: true, color: scoreColor(sub.score), fontFace: FONT, align: "right",
    });
    s8.addShape("roundRect" as PptxGenJS.ShapeType, {
      x: sx + 0.1, y: sy + 0.38, w: 2.7, h: 0.08,
      fill: { color: C.border }, rectRadius: 0.02,
    });
    s8.addShape("roundRect" as PptxGenJS.ShapeType, {
      x: sx + 0.1, y: sy + 0.38, w: Math.max(0.05, 2.7 * sub.score / 100), h: 0.08,
      fill: { color: scoreColor(sub.score) }, rectRadius: 0.02,
    });
    s8.addText(truncate(sub.description, 60), {
      x: sx + 0.1, y: sy + 0.52, w: 2.7, h: 0.3,
      fontSize: 7, color: C.muted, fontFace: FONT, valign: "top",
      shrinkText: true,
    });
  });
  addFooter(s8);

  // ── Slide 9: Creative Performance ──
  if (data.creatives && data.creatives.totalCreatives > 0) {
    const s9 = pptx.addSlide();
    s9.background = { color: C.white };
    addSlideTitle(s9, "Creative Performance", "D946EF");

    const crKpis = [
      { label: "Total Creatives", value: `${data.creatives.totalCreatives}` },
      { label: "Avg CTR", value: `${data.creatives.avgCtr}%` },
      { label: "Avg CPA", value: `$${data.creatives.avgCpa}` },
      { label: "Fatigued", value: `${data.creatives.fatiguedCount}` },
    ];

    crKpis.forEach((kpi, i) => {
      const kx = 0.4 + i * 3.2;
      s9.addShape("roundRect" as PptxGenJS.ShapeType, {
        x: kx, y: 1.0, w: 3.0, h: 0.9,
        fill: { color: C.bg }, rectRadius: 0.06,
      });
      s9.addText(kpi.label, {
        x: kx + 0.15, y: 1.06, w: 2.7, h: 0.2,
        fontSize: 8, bold: true, color: C.faint, fontFace: FONT,
      });
      s9.addText(kpi.value, {
        x: kx + 0.15, y: 1.3, w: 2.7, h: 0.45,
        fontSize: 20, bold: true, color: i === 3 && data.creatives.fatiguedCount > 0 ? C.amber : C.dark, fontFace: FONT,
      });
    });

    s9.addText(truncate(data.narratives.creatives || "", 350), {
      x: 0.4, y: 2.1, w: 12.5, h: 1.0,
      fontSize: 10, color: C.muted, fontFace: FONT, valign: "top", lineSpacingMultiple: 1.5,
      shrinkText: true,
    });

    if (data.creatives.topPerformers.length > 0) {
      s9.addText("Top Creatives", {
        x: 0.4, y: 3.2, w: 3, h: 0.25,
        fontSize: 8, bold: true, color: C.faint, fontFace: FONT,
      });
      data.creatives.topPerformers.slice(0, 5).forEach((cr, i) => {
        const cy = 3.5 + i * 0.42;
        s9.addShape("roundRect" as PptxGenJS.ShapeType, {
          x: 0.4, y: cy, w: 12.5, h: 0.38,
          fill: { color: i % 2 === 0 ? C.bg : C.white }, rectRadius: 0.03,
        });
        s9.addText(`${i + 1}. ${truncate(cr.headline, 30)}`, {
          x: 0.6, y: cy, w: 5.5, h: 0.38,
          fontSize: 9, color: C.dark, fontFace: FONT, valign: "middle",
        });
        s9.addText(`${cr.platform} / ${cr.type}`, {
          x: 6.2, y: cy, w: 2.0, h: 0.38,
          fontSize: 8, color: C.muted, fontFace: FONT, valign: "middle",
        });
        s9.addText(`${cr.conversions} conv.`, {
          x: 8.4, y: cy, w: 1.5, h: 0.38,
          fontSize: 9, bold: true, color: C.dark, fontFace: FONT, align: "right", valign: "middle",
        });
        s9.addText(`$${cr.cpa} CPA`, {
          x: 10.0, y: cy, w: 1.5, h: 0.38,
          fontSize: 9, color: C.dark, fontFace: FONT, align: "right", valign: "middle",
        });
        s9.addText(`${cr.ctr}% CTR`, {
          x: 11.5, y: cy, w: 1.4, h: 0.38,
          fontSize: 9, color: C.dark, fontFace: FONT, align: "right", valign: "middle",
        });
      });
    }
    addFooter(s9);
  }

  // ── Slide 10: Budget Optimization ──
  if (data.optimizer && data.optimizer.platforms.length > 0) {
    const s10 = pptx.addSlide();
    s10.background = { color: C.white };
    addSlideTitle(s10, "Budget Optimization", C.teal);

    s10.addText(truncate(data.narratives.optimizer || "", 350), {
      x: 0.4, y: 1.0, w: 12.5, h: 1.0,
      fontSize: 10, color: C.muted, fontFace: FONT, valign: "top", lineSpacingMultiple: 1.5,
      shrinkText: true,
    });

    s10.addText("Channel Efficiency", {
      x: 0.4, y: 2.2, w: 4, h: 0.25,
      fontSize: 8, bold: true, color: C.faint, fontFace: FONT,
    });

    data.optimizer.platforms.forEach((p, i) => {
      const py = 2.5 + i * 0.7;
      const sc = scoreColor(p.efficiencyScore);
      s10.addShape("roundRect" as PptxGenJS.ShapeType, {
        x: 0.4, y: py, w: 6.0, h: 0.6,
        fill: { color: C.bg }, rectRadius: 0.04,
      });
      s10.addText(`${i + 1}. ${p.platform.charAt(0).toUpperCase() + p.platform.slice(1)}`, {
        x: 0.6, y: py + 0.05, w: 2.5, h: 0.25,
        fontSize: 10, bold: true, color: C.dark, fontFace: FONT,
      });
      s10.addText(`Efficiency: ${p.efficiencyScore}/100`, {
        x: 3.2, y: py + 0.05, w: 3.0, h: 0.25,
        fontSize: 9, bold: true, color: sc, fontFace: FONT, align: "right",
      });
      s10.addShape("roundRect" as PptxGenJS.ShapeType, {
        x: 0.6, y: py + 0.38, w: 5.6, h: 0.08,
        fill: { color: C.border }, rectRadius: 0.02,
      });
      s10.addShape("roundRect" as PptxGenJS.ShapeType, {
        x: 0.6, y: py + 0.38, w: Math.max(0.1, 5.6 * p.efficiencyScore / 100), h: 0.08,
        fill: { color: sc }, rectRadius: 0.02,
      });
    });

    if (data.optimizer.projectedImpact.additionalConversions > 0 || data.optimizer.projectedImpact.cpaReduction > 0) {
      s10.addShape("roundRect" as PptxGenJS.ShapeType, {
        x: 7.0, y: 2.5, w: 5.9, h: 1.5,
        fill: { color: "ECFEFF" }, rectRadius: 0.06,
        line: { color: "A5F3FC", width: 1 },
      });
      s10.addText("Projected Impact", {
        x: 7.2, y: 2.6, w: 5.5, h: 0.3,
        fontSize: 8, bold: true, color: "0E7490", fontFace: FONT,
      });
      let impactText = "";
      if (data.optimizer.projectedImpact.additionalConversions > 0) {
        impactText += `+${data.optimizer.projectedImpact.additionalConversions} additional conversions\n`;
      }
      if (data.optimizer.projectedImpact.cpaReduction > 0) {
        impactText += `-${data.optimizer.projectedImpact.cpaReduction}% CPA reduction`;
      }
      s10.addText(impactText, {
        x: 7.2, y: 2.95, w: 5.5, h: 0.9,
        fontSize: 14, bold: true, color: "0E7490", fontFace: FONT, valign: "top", lineSpacingMultiple: 1.6,
      });
    }
    addFooter(s10);
  }

  // ── Slide: Recommendations ──
  const sRec = pptx.addSlide();
  sRec.background = { color: C.white };
  addSlideTitle(sRec, "Recommendations", C.amber);

  sRec.addShape("roundRect" as PptxGenJS.ShapeType, {
    x: 0.4, y: 1.0, w: 12.5, h: 3.6,
    fill: { color: C.amberBg }, rectRadius: 0.08,
  });
  sRec.addText(truncate(data.narratives.recommendations, 800), {
    x: 0.7, y: 1.2, w: 12, h: 3.2,
    fontSize: 12, color: "92400E", fontFace: FONT,
    valign: "top", lineSpacingMultiple: 1.7, paraSpaceAfter: 6,
    shrinkText: true,
  });

  sRec.addText("Generated by AdPulse", {
    x: 0.4, y: 4.8, w: 12.5, h: 0.3,
    fontSize: 9, color: C.faint, fontFace: FONT, align: "center",
  });

  await pptx.writeFile({ fileName: `${data.clientName} - Report ${data.dateRange.start}.pptx` });
}
