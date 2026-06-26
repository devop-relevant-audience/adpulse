'use client';

import { useAnomalies, useDailyTrend } from '@/hooks/use-metrics';
import { useAppStore } from '@/store/app-store';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { AlertTriangle, TrendingUp, TrendingDown, Info } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ResponsiveContainer, ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceDot } from 'recharts';
import type { AnomalyPoint } from '@/lib/data/queries';

const SEVERITY_CONFIG = {
  critical: { color: '#ef4444', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', label: 'Critical' },
  warning: { color: '#f59e0b', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', label: 'Warning' },
  info: { color: '#3b82f6', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', label: 'Info' },
} as const;

const METRIC_LABELS: Record<string, string> = {
  spend: 'Spend',
  ctr: 'CTR',
  cpc: 'CPC',
  cpa: 'CPA',
  conversions: 'Conversions',
};

function SeverityBadge({ severity }: { severity: AnomalyPoint['severity'] }) {
  const config = SEVERITY_CONFIG[severity];
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border', config.bg, config.border, config.text)}>
      {severity === 'critical' && <AlertTriangle className='w-3 h-3' />}
      {severity === 'warning' && <AlertTriangle className='w-3 h-3' />}
      {severity === 'info' && <Info className='w-3 h-3' />}
      {config.label}
    </span>
  );
}

function AnomalySummaryCards({ anomalies }: { anomalies: AnomalyPoint[] }) {
  const criticalCount = anomalies.filter((a) => a.severity === 'critical').length;
  const warningCount = anomalies.filter((a) => a.severity === 'warning').length;
  const infoCount = anomalies.filter((a) => a.severity === 'info').length;

  const cards = [
    { label: 'Total Anomalies', value: anomalies.length, color: 'text-ink' },
    { label: 'Critical', value: criticalCount, color: 'text-red-600' },
    { label: 'Warning', value: warningCount, color: 'text-amber-600' },
    { label: 'Info', value: infoCount, color: 'text-blue-600' },
  ];

  return (
    <div className='grid grid-cols-2 sm:grid-cols-4 gap-3'>
      {cards.map((card) => (
        <div key={card.label} className='bg-white rounded-xl border border-hairline p-4'>
          <p className='text-[11px] font-medium text-ink-muted uppercase tracking-wider'>{card.label}</p>
          <p className={cn('text-2xl font-semibold mt-1 tabular-nums', card.color)}>{card.value}</p>
        </div>
      ))}
    </div>
  );
}

function AnomalyChartTooltip({
  active,
  payload,
  label,
  spendAnomalies,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
  spendAnomalies: AnomalyPoint[];
}) {
  if (!active || !payload?.length || !label) return null;

  const spend = payload[0].value;
  const matchingAnomalies = spendAnomalies.filter((a) => a.date === label);

  return (
    <div className='bg-white border border-hairline rounded-xl text-xs shadow-lg' style={{ minWidth: matchingAnomalies.length > 0 ? 240 : undefined }}>
      <div className='px-3 py-2 border-b border-hairline/60'>
        <p className='font-medium text-ink'>{format(parseISO(label), 'EEE, MMM d, yyyy')}</p>
        <p className='text-ink-muted mt-0.5'>
          Spend: <span className='font-semibold text-ink'>${spend.toLocaleString()}</span>
        </p>
      </div>
      {matchingAnomalies.map((anomaly, i) => {
        const deviation = ((anomaly.value - anomaly.expected) / anomaly.expected) * 100;
        const sevConfig = SEVERITY_CONFIG[anomaly.severity];
        return (
          <div key={i} className='px-3 py-2 border-t border-hairline/40 first:border-t-0'>
            <div className='flex items-center justify-between gap-2 mb-1.5'>
              <span
                className={cn(
                  'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border',
                  sevConfig.bg,
                  sevConfig.border,
                  sevConfig.text,
                )}
              >
                {anomaly.severity === 'info' ? <Info className='w-2.5 h-2.5' /> : <AlertTriangle className='w-2.5 h-2.5' />}
                {sevConfig.label}
              </span>
              <span className={cn('text-[11px] font-semibold tabular-nums', deviation > 0 ? 'text-red-600' : 'text-emerald-600')}>
                {deviation > 0 ? '+' : ''}
                {deviation.toFixed(1)}%
              </span>
            </div>
            <div className='space-y-0.5 text-[11px] text-ink-muted'>
              <p>
                {anomaly.direction === 'spike' ? '↑ Spiked' : '↓ Dropped'} to <span className='font-medium text-ink'>${anomaly.value.toLocaleString()}</span>
              </p>
              <p>
                Expected: <span className='font-medium text-ink'>${anomaly.expected.toLocaleString()}</span>
              </p>
              <p>
                Z-Score: <span className='font-medium text-ink'>{anomaly.zScore.toFixed(2)}</span>
              </p>
              {anomaly.campaignName && (
                <p>
                  Campaign: <span className='font-medium text-ink'>{anomaly.campaignName}</span>
                </p>
              )}
              {anomaly.platform && (
                <p>
                  Platform: <span className='font-medium text-ink capitalize'>{anomaly.platform}</span>
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AnomalyChart({ anomalies }: { anomalies: AnomalyPoint[] }) {
  const clientId = useAppStore((s) => s.selectedClientId);
  const dateRange = useAppStore((s) => s.dateRange);
  const platform = useAppStore((s) => s.selectedPlatform);

  const { data: trend } = useDailyTrend({
    clientId,
    startDate: dateRange.start,
    endDate: dateRange.end,
    platform,
  });

  if (!trend) return null;

  const spendAnomalies = anomalies.filter((a) => a.metric === 'spend');

  return (
    <div className='bg-white rounded-xl border border-hairline p-5'>
      <h3 className='text-sm font-semibold text-ink mb-4'>Spend Anomalies Over Time</h3>
      <ResponsiveContainer width='100%' height={280}>
        <ComposedChart data={trend}>
          <defs>
            <linearGradient id='anomalySpendGrad' x1='0' y1='0' x2='0' y2='1'>
              <stop offset='0%' stopColor='#0075de' stopOpacity={0.12} />
              <stop offset='100%' stopColor='#0075de' stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke='#f0f0f0' strokeDasharray='none' vertical={false} />
          <XAxis
            dataKey='date'
            tickFormatter={(v) => format(parseISO(v), 'MMM d')}
            tick={{ fontSize: 11, fill: '#a39e98' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#a39e98' }}
            axisLine={false}
            tickLine={false}
            width={55}
            tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}`}
          />
          <Tooltip content={<AnomalyChartTooltip spendAnomalies={spendAnomalies} />} cursor={{ stroke: '#d4d4d4', strokeDasharray: '4 4' }} />
          <Area type='monotone' dataKey='spend' stroke='#0075de' strokeWidth={2} fill='url(#anomalySpendGrad)' dot={false} />
          {spendAnomalies.map((anomaly, i) => {
            const dataPoint = trend.find((t) => t.date === anomaly.date);
            if (!dataPoint) return null;
            return (
              <ReferenceDot
                key={`anomaly-${i}`}
                x={anomaly.date}
                y={dataPoint.spend}
                r={5}
                fill={SEVERITY_CONFIG[anomaly.severity].color}
                stroke='white'
                strokeWidth={2}
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function AnomalyList({ anomalies }: { anomalies: AnomalyPoint[] }) {
  const setReferenceContext = useAppStore((s) => s.setReferenceContext);

  if (anomalies.length === 0) {
    return (
      <div className='bg-white rounded-xl border border-hairline p-8 text-center'>
        <p className='text-ink-muted text-sm'>No anomalies detected in this period.</p>
      </div>
    );
  }

  return (
    <div className='bg-white rounded-xl border border-hairline overflow-hidden'>
      <div className='px-5 py-3 border-b border-hairline'>
        <h3 className='text-sm font-semibold text-ink'>Anomaly Events</h3>
      </div>
      <div className='divide-y divide-hairline/60'>
        {anomalies.slice(0, 20).map((anomaly, i) => {
          const deviation = ((anomaly.value - anomaly.expected) / anomaly.expected) * 100;
          return (
            <button
              key={`${anomaly.date}-${anomaly.metric}-${i}`}
              onClick={() =>
                setReferenceContext({
                  metric: anomaly.metric,
                  dateRange: { start: anomaly.date, end: anomaly.date },
                  value: anomaly.value,
                })
              }
              className='flex items-center gap-4 w-full px-5 py-3 text-left hover:bg-canvas-soft/50 transition-colors'
            >
              <div className='shrink-0'>
                {anomaly.direction === 'spike' ? (
                  <TrendingUp className={cn('w-4 h-4', SEVERITY_CONFIG[anomaly.severity].text)} />
                ) : (
                  <TrendingDown className={cn('w-4 h-4', SEVERITY_CONFIG[anomaly.severity].text)} />
                )}
              </div>
              <div className='flex-1 min-w-0'>
                <p className='text-[13px] font-medium text-ink'>
                  {METRIC_LABELS[anomaly.metric] || anomaly.metric}{' '}
                  <span className='text-ink-muted font-normal'>
                    {anomaly.direction === 'spike' ? 'spiked' : 'dropped'} to{' '}
                    {anomaly.metric === 'spend' || anomaly.metric === 'cpc' || anomaly.metric === 'cpa'
                      ? `$${anomaly.value.toLocaleString()}`
                      : anomaly.metric === 'ctr'
                        ? `${anomaly.value}%`
                        : anomaly.value.toLocaleString()}
                  </span>
                </p>
                <p className='text-[11px] text-ink-faint mt-0.5'>
                  Expected: {anomaly.expected.toLocaleString()} | Z-Score: {anomaly.zScore}
                </p>
              </div>
              <div className='text-right shrink-0'>
                <p className={cn('text-[13px] font-medium tabular-nums', deviation > 0 ? 'text-red-600' : 'text-emerald-600')}>
                  {deviation > 0 ? '+' : ''}
                  {deviation.toFixed(1)}%
                </p>
                <p className='text-[11px] text-ink-faint'>{format(parseISO(anomaly.date), 'MMM d, yyyy')}</p>
              </div>
              <SeverityBadge severity={anomaly.severity} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AnomalyDetector() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const dateRange = useAppStore((s) => s.dateRange);
  const platform = useAppStore((s) => s.selectedPlatform);

  const { data: anomalies, isLoading } = useAnomalies({
    clientId,
    startDate: dateRange.start,
    endDate: dateRange.end,
    platform,
  });

  if (!clientId || isLoading) {
    return (
      <div className='space-y-4'>
        <Skeleton className='h-24 w-full' />
        <Skeleton className='h-[300px] w-full' />
        <Skeleton className='h-[200px] w-full' />
      </div>
    );
  }

  const anomalyList = anomalies || [];

  return (
    <div className='space-y-4'>
      <div>
        <h2 className='text-lg font-semibold text-ink'>Anomaly Detection</h2>
        <p className='text-sm text-ink-muted mt-0.5'>Z-score analysis over a 7-day rolling window. Flags deviations exceeding 2 standard deviations.</p>
      </div>
      <AnomalySummaryCards anomalies={anomalyList} />
      <AnomalyChart anomalies={anomalyList} />
      <AnomalyList anomalies={anomalyList} />
    </div>
  );
}
