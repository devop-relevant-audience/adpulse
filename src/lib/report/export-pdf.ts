import type { ReportData } from "./builder";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

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

function deltaHtml(value: number, invert = false): string {
  const isGood = invert ? value < 0 : value >= 0;
  const arrow = value >= 0 ? "&#x25B2;" : "&#x25BC;";
  const cls = isGood ? "delta-good" : "delta-bad";
  return `<span class="${cls}">${arrow} ${value >= 0 ? "+" : ""}${value.toFixed(1)}%</span>`;
}

const PLATFORM_LABELS: Record<string, string> = { google: "Google Ads", meta: "Meta Ads", tiktok: "TikTok Ads" };
const PLATFORM_COLORS: Record<string, string> = { google: "#4285F4", meta: "#0668E1", tiktok: "#fe2c55" };

function scoreColor(score: number): string {
  if (score >= 80) return "#16a34a";
  if (score >= 60) return "#2563eb";
  if (score >= 40) return "#d97706";
  return "#dc2626";
}

function buildSparklineSvg(data: number[], color: string, h = 50): string {
  if (data.length < 2) return "";
  const w = 400;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pad = 4;
  const usableH = h - pad * 2;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => ({ x: i * step, y: pad + usableH - ((v - min) / range) * usableH }));
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L ${pts[pts.length - 1].x.toFixed(1)} ${h} L 0 ${h} Z`;
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px" preserveAspectRatio="none">
    <defs><linearGradient id="sg-${color.slice(1)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.18"/><stop offset="100%" stop-color="${color}" stop-opacity="0.02"/></linearGradient></defs>
    <path d="${area}" fill="url(#sg-${color.slice(1)})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

function buildDonutSvg(segments: Array<{ value: number; color: string; label: string }>, centerTop: string, centerBottom: string): string {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return "";
  const r = 38;
  const cx = 50;
  const cy = 50;
  const sw = 11;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const arcs = segments.map((seg) => {
    const pct = seg.value / total;
    const dashLen = pct * circ;
    const dashGap = circ - dashLen;
    const o = offset;
    offset += dashLen;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${sw}" stroke-dasharray="${dashLen.toFixed(2)} ${dashGap.toFixed(2)}" stroke-dashoffset="${(-o).toFixed(2)}" stroke-linecap="round"/>`;
  }).join("");
  const legend = segments.map((seg) => `<div style="display:flex;align-items:center;gap:6px;margin-top:4px"><span style="width:8px;height:8px;border-radius:50%;background:${seg.color};flex-shrink:0"></span><span style="font-size:11px;color:#615d59">${esc(seg.label)}</span><span style="margin-left:auto;font-size:11px;font-weight:600;color:#1a1a1a">${(seg.value / total * 100).toFixed(0)}%</span></div>`).join("");
  return `<div style="display:flex;align-items:center;gap:24px">
    <div style="position:relative;width:110px;height:110px;flex-shrink:0">
      <svg viewBox="0 0 100 100" style="width:100%;height:100%;transform:rotate(-90deg)">${arcs}</svg>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
        <span style="font-size:15px;font-weight:700;color:#1a1a1a;line-height:1">${esc(centerTop)}</span>
        <span style="font-size:8px;text-transform:uppercase;letter-spacing:0.5px;color:#a39e98;margin-top:2px">${esc(centerBottom)}</span>
      </div>
    </div>
    <div style="flex:1">${legend}</div>
  </div>`;
}

function buildFunnelSvg(stages: Array<{ stage: string; volume: number; percentOfFirst: number; percentOfPrevious: number }>): string {
  if (stages.length < 2) return "";
  const colors = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b"];
  return stages.map((s, i) => {
    const widthPct = i === 0 ? 100 : Math.max(20, s.percentOfFirst);
    const color = colors[i % colors.length];
    return `<div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
      <div style="width:70px;text-align:right;flex-shrink:0"><span style="font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#615d59">${esc(s.stage)}</span></div>
      <div style="flex:1"><div style="height:36px;border-radius:8px;background:${color};width:${widthPct}%;display:flex;align-items:center;padding-left:12px;transition:width 0.5s"><span style="font-size:12px;font-weight:700;color:#fff">${formatNum(s.volume)}</span></div></div>
      <div style="width:48px;text-align:right;flex-shrink:0">${i > 0 ? `<span style="font-size:11px;font-weight:500;color:#615d59">${s.percentOfPrevious}%</span>` : ""}</div>
    </div>`;
  }).join("");
}

function buildHealthGaugeSvg(score: number, grade: string): string {
  const color = scoreColor(score);
  const r = 44;
  const cx = 55;
  const cy = 55;
  const sw = 9;
  const startAngle = 135;
  const endAngle = 405;
  const totalAngle = endAngle - startAngle;
  const scoreAngle = startAngle + (score / 100) * totalAngle;

  function polar(angle: number) {
    const rad = (angle * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }
  function arc(s: number, e: number) {
    const sp = polar(s);
    const ep = polar(e);
    const large = e - s > 180 ? 1 : 0;
    return `M ${sp.x.toFixed(1)} ${sp.y.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${ep.x.toFixed(1)} ${ep.y.toFixed(1)}`;
  }

  return `<div style="position:relative;width:110px;height:90px;flex-shrink:0">
    <svg viewBox="0 0 110 110" style="width:100%;height:100%">
      <path d="${arc(startAngle, endAngle)}" fill="none" stroke="#f0f0f0" stroke-width="${sw}" stroke-linecap="round"/>
      ${score > 0 ? `<path d="${arc(startAngle, scoreAngle)}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>` : ""}
    </svg>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding-top:8px">
      <span style="font-size:22px;font-weight:700;color:${color};line-height:1">${score}</span>
      <span style="font-size:9px;font-weight:600;color:#615d59;margin-top:2px">Grade ${esc(grade)}</span>
    </div>
  </div>`;
}

export function generatePdfHtml(data: ReportData): string {
  const { comparison, trendSummary, platformBreakdown, funnel, campaignBreakdown, healthScore, narratives } = data;
  const c = comparison.current;
  const d = comparison.deltas;

  const heroKpis = [
    { label: "Total Spend", value: formatCurrency(c.totalSpend), delta: d.totalSpend.percentage },
    { label: "Conversions", value: formatNum(c.totalConversions), delta: d.totalConversions.percentage },
    { label: "CPA", value: formatCurrency(c.avgCpa), delta: d.avgCpa.percentage, invert: true },
    { label: "CTR", value: `${c.avgCtr}%`, delta: d.avgCtr.percentage },
  ];
  const secondaryKpis = [
    { label: "Clicks", value: formatNum(c.totalClicks), delta: d.totalClicks.percentage },
    { label: "Impressions", value: formatNum(c.totalImpressions), delta: d.totalImpressions.percentage },
    { label: "CPC", value: formatCurrency(c.avgCpc), delta: d.avgCpc.percentage, invert: true },
    { label: "CPM", value: formatCurrency(c.avgCpm), delta: d.avgCpm.percentage, invert: true },
  ];

  const sortedPlatforms = [...platformBreakdown].sort((a, b) => b.spend - a.spend);
  const donutSegments = sortedPlatforms.map((p) => ({
    value: p.spend,
    color: PLATFORM_COLORS[p.platform] || "#888",
    label: PLATFORM_LABELS[p.platform] || p.platform,
  }));

  const topCampaigns = [...campaignBreakdown].sort((a, b) => b.conversions - a.conversions).slice(0, 8);
  const worstCtr = [...campaignBreakdown].sort((a, b) => a.ctr - b.ctr).slice(0, 3);

  const spendData = trendSummary.dailyData.map((d) => d.spend);
  const convData = trendSummary.dailyData.map((d) => d.conversions);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(data.clientName)} — Performance Report</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html { height: auto !important; overflow: auto !important; overflow-y: scroll !important; scroll-behavior: smooth; -webkit-font-smoothing: antialiased; }
    body { font-family: 'Inter', -apple-system, system-ui, sans-serif; color: #1a1a1a; background: #f8f7f6; line-height: 1.6; height: auto !important; overflow: visible !important; min-height: 100vh; }
    .report-wrapper { max-width: 860px; margin: 0 auto; padding: 40px 24px 60px; }
    .report-header { text-align: center; margin-bottom: 40px; }
    .report-header h1 { font-size: 28px; font-weight: 800; letter-spacing: -1px; color: #1a1a1a; margin-bottom: 6px; }
    .report-header .subtitle { font-size: 13px; color: #615d59; }
    .report-header .meta { font-size: 10px; color: #a39e98; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
    .section { background: #fff; border-radius: 16px; border: 1px solid #eee; padding: 28px; margin-bottom: 20px; }
    .section-title { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
    .section-title .icon { width: 32px; height: 32px; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 14px; flex-shrink: 0; }
    .section-title h2 { font-size: 16px; font-weight: 700; color: #1a1a1a; }
    .narrative { font-size: 13px; line-height: 1.75; color: #31302e; margin-bottom: 20px; }
    .highlight-box { background: linear-gradient(135deg, #f8fafc, #eff6ff); border-radius: 12px; padding: 16px 20px; border: 1px solid #e2e8f0; margin-bottom: 20px; }
    .highlight-box p { font-size: 13px; line-height: 1.75; color: #334155; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 10px; }
    .kpi-card { background: #fff; border: 1px solid #eee; border-radius: 12px; padding: 16px; }
    .kpi-card .label { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: #615d59; }
    .kpi-card .value { font-size: 20px; font-weight: 700; color: #1a1a1a; margin-top: 4px; letter-spacing: -0.3px; }
    .kpi-card .delta-wrap { margin-top: 6px; }
    .secondary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .secondary-card { background: #f8f7f6; border-radius: 10px; padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; }
    .secondary-card .label { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px; color: #615d59; }
    .secondary-card .value { font-size: 13px; font-weight: 600; color: #1a1a1a; margin-top: 2px; }
    .delta-good { color: #16a34a; font-size: 10px; font-weight: 600; }
    .delta-bad { color: #dc2626; font-size: 10px; font-weight: 600; }
    .trend-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
    .trend-card { background: #f8f7f6; border-radius: 12px; padding: 14px; }
    .trend-card .card-label { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px; color: #615d59; margin-bottom: 4px; }
    .trend-card .card-value { font-size: 13px; font-weight: 700; color: #1a1a1a; margin-bottom: 8px; }
    .stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .stat-pill { border-radius: 10px; padding: 10px 12px; border: 1px solid; }
    .stat-pill .stat-label { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-pill .stat-value { font-size: 13px; font-weight: 700; color: #1a1a1a; margin-top: 2px; }
    .stat-pill .stat-sub { font-size: 10px; font-weight: 500; }
    .platform-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 14px; }
    .platform-detail-grid { display: grid; gap: 8px; margin-top: 10px; }
    .platform-detail { background: #f8f7f6; border-radius: 10px; padding: 12px 14px; }
    .platform-detail .pd-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .platform-detail .pd-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .platform-detail .pd-name { font-size: 12px; font-weight: 600; color: #1a1a1a; }
    .platform-detail .pd-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
    .platform-detail .pd-metric-label { font-size: 8px; text-transform: uppercase; color: #a39e98; }
    .platform-detail .pd-metric-value { font-size: 12px; font-weight: 600; color: #1a1a1a; }
    .funnel-wrap { background: #f8f7f6; border-radius: 12px; padding: 20px; }
    .camp-list { margin-top: 8px; }
    .camp-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; margin-bottom: 6px; }
    .camp-row.top { background: #f0fdf4; border: 1px solid #bbf7d0; }
    .camp-row.warn { background: #fffbeb; border: 1px solid #fde68a; }
    .camp-rank { width: 24px; height: 24px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #fff; flex-shrink: 0; }
    .camp-info { flex: 1; min-width: 0; }
    .camp-name { font-size: 12px; font-weight: 500; color: #1a1a1a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .camp-platform { font-size: 9px; background: #f0f0f0; padding: 1px 6px; border-radius: 4px; color: #615d59; display: inline-block; margin-top: 2px; text-transform: capitalize; }
    .camp-stats { display: flex; gap: 16px; flex-shrink: 0; }
    .camp-stat { text-align: right; }
    .camp-stat-label { font-size: 8px; color: #a39e98; text-transform: uppercase; }
    .camp-stat-value { font-size: 12px; font-weight: 600; color: #1a1a1a; }
    .health-wrap { display: flex; align-items: flex-start; gap: 20px; margin-bottom: 20px; }
    .health-info { flex: 1; padding-top: 8px; }
    .health-info .h-title { font-size: 14px; font-weight: 600; color: #1a1a1a; margin-bottom: 4px; }
    .health-info .h-desc { font-size: 12px; color: #615d59; line-height: 1.6; }
    .subscore-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .subscore { background: #f8f7f6; border-radius: 10px; padding: 12px; }
    .subscore .ss-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
    .subscore .ss-name { font-size: 11px; font-weight: 600; color: #1a1a1a; }
    .subscore .ss-score { font-size: 12px; font-weight: 700; }
    .subscore .ss-bar { height: 6px; background: #e0e0e0; border-radius: 3px; overflow: hidden; margin-bottom: 6px; }
    .subscore .ss-fill { height: 100%; border-radius: 3px; }
    .subscore .ss-desc { font-size: 10px; color: #615d59; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .rec-box { background: linear-gradient(135deg, #fffbeb, #fef3c7); border: 1px solid #fde68a; border-radius: 12px; padding: 16px 20px; }
    .rec-box p { font-size: 13px; line-height: 1.75; color: #92400e; }
    .footer { text-align: center; padding: 24px 0 0; font-size: 10px; color: #a39e98; border-top: 1px solid #eee; margin-top: 8px; }
    .sub-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #615d59; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
    @media print {
      body { background: #fff; }
      .report-wrapper { padding: 20px 0; }
      .section { border: 1px solid #e0e0e0; break-inside: avoid; }
    }
    @media (max-width: 640px) {
      .kpi-grid, .secondary-grid, .stats-row { grid-template-columns: repeat(2, 1fr); }
      .platform-grid, .trend-grid { grid-template-columns: 1fr; }
      .subscore-grid { grid-template-columns: repeat(2, 1fr); }
      .camp-stats { gap: 10px; }
    }
  </style>
</head>
<body>
  <div class="report-wrapper">

    <div class="report-header">
      <h1>${esc(data.clientName)}</h1>
      <p class="subtitle">Performance Report &middot; ${esc(data.dateRange.start)} to ${esc(data.dateRange.end)}</p>
      <p class="meta">Generated ${new Date(data.generatedAt).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} &middot; vs. ${esc(data.comparisonRange.start)} to ${esc(data.comparisonRange.end)}</p>
    </div>

    <!-- Executive Summary -->
    <div class="section">
      <div class="section-title">
        <div class="icon" style="background:linear-gradient(135deg,#6366f1,#818cf8)">&#9889;</div>
        <h2>Executive Summary</h2>
      </div>
      <div class="highlight-box"><p>${esc(narratives.executive)}</p></div>
    </div>

    <!-- KPI Overview -->
    <div class="section">
      <div class="section-title">
        <div class="icon" style="background:linear-gradient(135deg,#3b82f6,#60a5fa)">&#9776;</div>
        <h2>KPI Overview</h2>
      </div>
      <div class="kpi-grid">
        ${heroKpis.map((k) => `<div class="kpi-card"><div class="label">${esc(k.label)}</div><div class="value">${esc(k.value)}</div><div class="delta-wrap">${deltaHtml(k.delta, k.invert)}</div></div>`).join("")}
      </div>
      <div class="secondary-grid">
        ${secondaryKpis.map((k) => `<div class="secondary-card"><div><div class="label">${esc(k.label)}</div><div class="value">${esc(k.value)}</div></div>${deltaHtml(k.delta, k.invert)}</div>`).join("")}
      </div>
    </div>

    <!-- Trends -->
    <div class="section">
      <div class="section-title">
        <div class="icon" style="background:linear-gradient(135deg,#8b5cf6,#a78bfa)">&#8599;</div>
        <h2>Performance Trends</h2>
      </div>
      <p class="narrative">${esc(narratives.trends)}</p>
      <div class="trend-grid">
        <div class="trend-card">
          <div class="card-label">Daily Spend Trend</div>
          <div class="card-value">Avg. ${formatCurrency(trendSummary.avgDailySpend)}/day</div>
          ${buildSparklineSvg(spendData, "#2563eb")}
        </div>
        <div class="trend-card">
          <div class="card-label">Daily Conversions Trend</div>
          <div class="card-value">${formatNum(c.totalConversions)} total</div>
          ${buildSparklineSvg(convData, "#16a34a")}
        </div>
      </div>
      <div class="stats-row">
        <div class="stat-pill" style="background:#f0fdf4;border-color:#bbf7d0">
          <div class="stat-label" style="color:#16a34a">Best Day</div>
          <div class="stat-value">${esc(trendSummary.bestDay.date)}</div>
          <div class="stat-sub" style="color:#16a34a">${trendSummary.bestDay.conversions} conv.</div>
        </div>
        <div class="stat-pill" style="background:#fef2f2;border-color:#fecaca">
          <div class="stat-label" style="color:#dc2626">Worst Day</div>
          <div class="stat-value">${esc(trendSummary.worstDay.date)}</div>
          <div class="stat-sub" style="color:#dc2626">${trendSummary.worstDay.conversions} conv.</div>
        </div>
        <div class="stat-pill" style="background:#eff6ff;border-color:#bfdbfe">
          <div class="stat-label" style="color:#2563eb">Avg Daily Spend</div>
          <div class="stat-value">${formatCurrency(trendSummary.avgDailySpend)}</div>
        </div>
        <div class="stat-pill" style="background:#fffbeb;border-color:#fde68a">
          <div class="stat-label" style="color:#d97706">Volatility</div>
          <div class="stat-value">${(trendSummary.spendVolatility * 100).toFixed(1)}%</div>
        </div>
      </div>
    </div>

    <!-- Platform Breakdown -->
    <div class="section">
      <div class="section-title">
        <div class="icon" style="background:linear-gradient(135deg,#0ea5e9,#38bdf8)">&#9881;</div>
        <h2>Platform Breakdown</h2>
      </div>
      <p class="narrative">${esc(narratives.platforms)}</p>
      <div class="platform-grid">
        <div style="background:#f8f7f6;border-radius:12px;padding:16px">
          <div class="sub-label">Spend Distribution</div>
          ${buildDonutSvg(donutSegments, formatCurrency(c.totalSpend), "Total")}
        </div>
        <div style="background:#f8f7f6;border-radius:12px;padding:16px">
          <div class="sub-label">Conversions by Platform</div>
          ${sortedPlatforms.map((p) => {
            const maxConv = Math.max(...sortedPlatforms.map((x) => x.conversions));
            const pct = maxConv > 0 ? (p.conversions / maxConv) * 100 : 0;
            return `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><div style="display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:${PLATFORM_COLORS[p.platform] || "#888"};flex-shrink:0"></span><span style="font-size:11px;font-weight:500;color:#1a1a1a">${esc(PLATFORM_LABELS[p.platform] || p.platform)}</span></div><span style="font-size:11px;font-weight:600;color:#1a1a1a">${formatNum(p.conversions)} at ${formatCurrency(p.cpa)} CPA</span></div><div style="height:7px;background:#e8e8e8;border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${PLATFORM_COLORS[p.platform] || "#888"};border-radius:4px;opacity:0.8"></div></div></div>`;
          }).join("")}
        </div>
      </div>
      <div class="platform-detail-grid" style="grid-template-columns:repeat(${sortedPlatforms.length}, 1fr)">
        ${sortedPlatforms.map((p) => `<div class="platform-detail">
          <div class="pd-head"><span class="pd-dot" style="background:${PLATFORM_COLORS[p.platform] || "#888"}"></span><span class="pd-name">${esc(PLATFORM_LABELS[p.platform] || p.platform)}</span></div>
          <div class="pd-metrics">
            <div><div class="pd-metric-label">CTR</div><div class="pd-metric-value">${p.ctr}%</div></div>
            <div><div class="pd-metric-label">CPA</div><div class="pd-metric-value">${formatCurrency(p.cpa)}</div></div>
            <div><div class="pd-metric-label">CPC</div><div class="pd-metric-value">${formatCurrency(p.cpc)}</div></div>
            <div><div class="pd-metric-label">Share</div><div class="pd-metric-value">${p.pctOfSpend}%</div></div>
          </div>
        </div>`).join("")}
      </div>
    </div>

    <!-- Funnel -->
    <div class="section">
      <div class="section-title">
        <div class="icon" style="background:linear-gradient(135deg,#8b5cf6,#a78bfa)">&#8594;</div>
        <h2>Funnel Analysis</h2>
      </div>
      <p class="narrative">${esc(narratives.funnel)}</p>
      ${funnel.overall.length >= 2 ? `<div class="funnel-wrap">${buildFunnelSvg(funnel.overall)}</div>` : ""}
    </div>

    <!-- Campaign Performance -->
    <div class="section">
      <div class="section-title">
        <div class="icon" style="background:linear-gradient(135deg,#10b981,#34d399)">&#9678;</div>
        <h2>Campaign Performance</h2>
      </div>
      <p class="narrative">${esc(narratives.campaigns)}</p>
      ${topCampaigns.length > 0 ? `
      <div class="sub-label"><span style="color:#16a34a">&#9650;</span> Top Performers</div>
      <div class="camp-list">
        ${topCampaigns.map((camp, i) => `<div class="camp-row top">
          <div class="camp-rank" style="background:${i < 2 ? "#16a34a" : "#86efac"}">${i + 1}</div>
          <div class="camp-info"><div class="camp-name">${esc(camp.campaignName)}</div><span class="camp-platform">${esc(camp.platform)}</span></div>
          <div class="camp-stats">
            <div class="camp-stat"><div class="camp-stat-label">Conv.</div><div class="camp-stat-value">${camp.conversions}</div></div>
            <div class="camp-stat"><div class="camp-stat-label">CPA</div><div class="camp-stat-value">${formatCurrency(camp.cpa)}</div></div>
            <div class="camp-stat"><div class="camp-stat-label">Spend</div><div class="camp-stat-value">${formatCurrency(camp.spend)}</div></div>
          </div>
        </div>`).join("")}
      </div>` : ""}
      ${worstCtr.length > 0 ? `
      <div class="sub-label" style="margin-top:16px"><span style="color:#d97706">&#9660;</span> Needs Attention (Low CTR)</div>
      <div class="camp-list">
        ${worstCtr.map((camp) => `<div class="camp-row warn">
          <div class="camp-info"><div class="camp-name">${esc(camp.campaignName)}</div><span class="camp-platform">${esc(camp.platform)}</span></div>
          <div class="camp-stats">
            <div class="camp-stat"><div class="camp-stat-label">CTR</div><div class="camp-stat-value" style="color:#d97706">${camp.ctr}%</div></div>
            <div class="camp-stat"><div class="camp-stat-label">CPA</div><div class="camp-stat-value">${formatCurrency(camp.cpa)}</div></div>
          </div>
        </div>`).join("")}
      </div>` : ""}
    </div>

    <!-- Health Score -->
    <div class="section">
      <div class="section-title">
        <div class="icon" style="background:linear-gradient(135deg,#ec4899,#f472b6)">&#9829;</div>
        <h2>Account Health</h2>
      </div>
      <p class="narrative">${esc(narratives.health)}</p>
      <div class="health-wrap">
        ${buildHealthGaugeSvg(healthScore.overallScore, healthScore.grade)}
        <div class="health-info">
          <div class="h-title">Overall Health: <span style="color:${scoreColor(healthScore.overallScore)}">${healthScore.overallScore}/100</span></div>
          <div class="h-desc">${esc(healthScore.insight)}</div>
        </div>
      </div>
      <div class="subscore-grid">
        ${healthScore.subScores.map((s) => `<div class="subscore">
          <div class="ss-head"><span class="ss-name">${esc(s.name)}</span><span class="ss-score" style="color:${scoreColor(s.score)}">${s.score.toFixed(0)}</span></div>
          <div class="ss-bar"><div class="ss-fill" style="width:${s.score}%;background:${scoreColor(s.score)}"></div></div>
          <div class="ss-desc">${esc(s.description)}</div>
        </div>`).join("")}
      </div>
    </div>

    <!-- Recommendations -->
    <div class="section">
      <div class="section-title">
        <div class="icon" style="background:linear-gradient(135deg,#f59e0b,#fbbf24)">&#128161;</div>
        <h2>Recommendations</h2>
      </div>
      <div class="rec-box"><p>${esc(narratives.recommendations)}</p></div>
    </div>

    <div class="footer">
      <p>Generated by AdPulse &middot; ${new Date(data.generatedAt).toLocaleDateString()}</p>
    </div>

  </div>
</body>
</html>`;
}
