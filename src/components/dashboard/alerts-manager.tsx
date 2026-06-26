"use client";

import { useState } from "react";
import { useAppStore } from "@/store/app-store";
import {
  useAlertRules,
  useAlertHistory,
  useCreateAlertRule,
  useUpdateAlertRule,
  useDeleteAlertRule,
  useEvaluateAlerts,
  useUpdateAlertHistory,
  useCampaigns,
} from "@/hooks/use-metrics";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  Bell,
  Plus,
  Trash2,
  Play,
  X,
  AlertTriangle,
  Info,
  Check,
  Eye,
  Loader2,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import type { AlertRuleRow, AlertRuleInsert, AlertSeverity, Platform } from "@/lib/types/database";

const SEVERITY_CONFIG: Record<AlertSeverity, { bg: string; border: string; text: string }> = {
  critical: { bg: "bg-red-50", border: "border-red-200", text: "text-red-700" },
  warning: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700" },
  info: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700" },
};

const METRIC_LABELS: Record<string, string> = {
  spend: "Spend", cpa: "CPA", ctr: "CTR", cpc: "CPC",
  conversions: "Conversions", impressions: "Impressions",
};

const CONDITION_LABELS: Record<string, string> = {
  above: "Above", below: "Below",
  increases_by_pct: "Increases by %", decreases_by_pct: "Decreases by %",
};

function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const c = SEVERITY_CONFIG[severity];
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border", c.bg, c.border, c.text)}>
      {severity === "info" ? <Info className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
      {severity}
    </span>
  );
}

const DEFAULT_RULE: Omit<AlertRuleInsert, "client_id"> = {
  name: "",
  metric: "spend",
  condition: "above",
  threshold: 0,
  evaluation_window: "daily",
  platform: null,
  campaign_id: null,
  enabled: true,
  recipients: [],
  frequency: "realtime",
  severity: "warning",
  quiet_hours_enabled: false,
  quiet_hours_start: "22:00",
  quiet_hours_end: "07:00",
};

function AlertRuleForm({
  clientId,
  initial,
  onClose,
}: {
  clientId: string;
  initial?: AlertRuleRow;
  onClose: () => void;
}) {
  const [form, setForm] = useState(() => {
    if (initial) {
      return {
        name: initial.name,
        metric: initial.metric,
        condition: initial.condition,
        threshold: initial.threshold,
        evaluation_window: initial.evaluation_window,
        platform: initial.platform,
        campaign_id: initial.campaign_id,
        enabled: initial.enabled,
        recipients: initial.recipients,
        frequency: initial.frequency,
        severity: initial.severity,
        quiet_hours_enabled: initial.quiet_hours_enabled,
        quiet_hours_start: initial.quiet_hours_start || "22:00",
        quiet_hours_end: initial.quiet_hours_end || "07:00",
      };
    }
    return { ...DEFAULT_RULE };
  });
  const [emailInput, setEmailInput] = useState("");
  const { data: campaigns } = useCampaigns(clientId);
  const createRule = useCreateAlertRule();
  const updateRule = useUpdateAlertRule();

  function addEmail() {
    const email = emailInput.trim();
    if (email && email.includes("@") && !form.recipients.includes(email)) {
      setForm((f) => ({ ...f, recipients: [...f.recipients, email] }));
      setEmailInput("");
    }
  }

  function removeEmail(email: string) {
    setForm((f) => ({ ...f, recipients: f.recipients.filter((e) => e !== email) }));
  }

  async function handleSubmit() {
    if (initial) {
      await updateRule.mutateAsync({ id: initial.id, ...form });
    } else {
      await createRule.mutateAsync({ ...form, client_id: clientId } as AlertRuleInsert);
    }
    onClose();
  }

  const isBusy = createRule.isPending || updateRule.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-2xl border border-hairline shadow-xl w-full max-w-[560px] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
          <h2 className="text-[15px] font-semibold text-ink">
            {initial ? "Edit Alert Rule" : "Create Alert Rule"}
          </h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-[11px] font-medium text-ink-muted uppercase tracking-wider block mb-1.5">Name</label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. High CPA Alert" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-ink-muted uppercase tracking-wider block mb-1.5">Metric</label>
              <Select value={form.metric} onValueChange={(v) => { if (v) setForm((f) => ({ ...f, metric: v as typeof f.metric })); }}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(METRIC_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-ink-muted uppercase tracking-wider block mb-1.5">Condition</label>
              <Select value={form.condition} onValueChange={(v) => { if (v) setForm((f) => ({ ...f, condition: v as typeof f.condition })); }}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CONDITION_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-ink-muted uppercase tracking-wider block mb-1.5">Threshold</label>
              <Input type="number" step="any" value={form.threshold} onChange={(e) => setForm((f) => ({ ...f, threshold: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div>
              <label className="text-[11px] font-medium text-ink-muted uppercase tracking-wider block mb-1.5">Evaluation Window</label>
              <Select value={form.evaluation_window} onValueChange={(v) => { if (v) setForm((f) => ({ ...f, evaluation_window: v as "daily" | "weekly" })); }}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-ink-muted uppercase tracking-wider block mb-1.5">Platform (optional)</label>
              <Select value={form.platform || "all"} onValueChange={(v) => { if (v) setForm((f) => ({ ...f, platform: v === "all" ? null : v as Platform })); }}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Platforms</SelectItem>
                  <SelectItem value="google">Google Ads</SelectItem>
                  <SelectItem value="meta">Meta Ads</SelectItem>
                  <SelectItem value="tiktok">TikTok Ads</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-ink-muted uppercase tracking-wider block mb-1.5">Campaign (optional)</label>
              <Select value={form.campaign_id || "all"} onValueChange={(v) => { if (v) setForm((f) => ({ ...f, campaign_id: v === "all" ? null : v })); }}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Campaigns</SelectItem>
                  {campaigns?.map((c) => <SelectItem key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-ink-muted uppercase tracking-wider block mb-1.5">Severity</label>
              <Select value={form.severity} onValueChange={(v) => { if (v) setForm((f) => ({ ...f, severity: v as AlertSeverity })); }}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-ink-muted uppercase tracking-wider block mb-1.5">Delivery Frequency</label>
              <Select value={form.frequency} onValueChange={(v) => { if (v) setForm((f) => ({ ...f, frequency: v as typeof f.frequency })); }}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="realtime">Real-time</SelectItem>
                  <SelectItem value="hourly_digest">Hourly Digest</SelectItem>
                  <SelectItem value="daily_digest">Daily Digest</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-medium text-ink-muted uppercase tracking-wider block mb-1.5">Recipients</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {form.recipients.map((email) => (
                <span key={email} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-canvas-soft text-[12px] text-ink">
                  {email}
                  <button onClick={() => removeEmail(email)} className="text-ink-muted hover:text-ink"><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addEmail(); } }}
                placeholder="email@example.com"
                className="flex-1"
              />
              <Button variant="outline" size="sm" onClick={addEmail}>Add</Button>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.quiet_hours_enabled}
                onChange={(e) => setForm((f) => ({ ...f, quiet_hours_enabled: e.target.checked }))}
                className="rounded border-hairline"
              />
              <span className="text-[13px] text-ink">Quiet hours</span>
            </label>
            {form.quiet_hours_enabled && (
              <div className="flex items-center gap-2">
                <Input type="time" value={form.quiet_hours_start ?? "22:00"} onChange={(e) => setForm((f) => ({ ...f, quiet_hours_start: e.target.value }))} className="w-28 h-8 text-[12px]" />
                <span className="text-[12px] text-ink-muted">to</span>
                <Input type="time" value={form.quiet_hours_end ?? "07:00"} onChange={(e) => setForm((f) => ({ ...f, quiet_hours_end: e.target.value }))} className="w-28 h-8 text-[12px]" />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                className="rounded border-hairline"
              />
              <span className="text-[13px] text-ink">Enabled</span>
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-hairline">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isBusy || !form.name || form.recipients.length === 0}>
            {isBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
            {initial ? "Save Changes" : "Create Rule"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RulesTab({ clientId }: { clientId: string }) {
  const { data: rules, isLoading } = useAlertRules(clientId);
  const updateRule = useUpdateAlertRule();
  const deleteRule = useDeleteAlertRule();
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRuleRow | undefined>();

  if (isLoading) return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-ink-muted">{rules?.length || 0} rule{rules?.length !== 1 ? "s" : ""} configured</p>
        <Button size="sm" onClick={() => { setEditingRule(undefined); setShowForm(true); }} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Create Rule
        </Button>
      </div>

      {(!rules || rules.length === 0) && (
        <div className="text-center py-12">
          <Bell className="w-10 h-10 text-ink-muted/40 mx-auto mb-3" />
          <p className="text-[13px] text-ink-muted">No alert rules configured yet.</p>
          <p className="text-[12px] text-ink-muted mt-1">Create a rule to get notified when metrics change.</p>
        </div>
      )}

      <div className="space-y-3">
        {rules?.map((rule) => (
          <div key={rule.id} className="bg-white rounded-xl border border-hairline p-4 flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <h4 className="text-[14px] font-medium text-ink truncate">{rule.name}</h4>
                <SeverityBadge severity={rule.severity} />
                {!rule.enabled && <Badge variant="outline" className="text-[10px]">Paused</Badge>}
              </div>
              <p className="text-[12px] text-ink-muted">
                {METRIC_LABELS[rule.metric]} {CONDITION_LABELS[rule.condition]} {rule.threshold}
                {rule.platform ? ` on ${rule.platform}` : ""}
                {" "}&middot;{" "}{rule.evaluation_window} check
                {" "}&middot;{" "}{rule.frequency.replace("_", " ")}
              </p>
              <p className="text-[11px] text-ink-muted mt-1">
                {rule.recipients.length} recipient{rule.recipients.length !== 1 ? "s" : ""}
                {rule.quiet_hours_enabled ? ` · Quiet ${rule.quiet_hours_start}–${rule.quiet_hours_end}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => updateRule.mutate({ id: rule.id, enabled: !rule.enabled })}
                className={cn("w-8 h-5 rounded-full transition-colors relative", rule.enabled ? "bg-primary" : "bg-ink-muted/30")}
              >
                <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform", rule.enabled ? "left-3.5" : "left-0.5")} />
              </button>
              <button onClick={() => { setEditingRule(rule); setShowForm(true); }} className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-canvas-soft">
                <Eye className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => deleteRule.mutate(rule.id)} className="p-1.5 rounded-md text-ink-muted hover:text-red-600 hover:bg-red-50">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <AlertRuleForm
          clientId={clientId}
          initial={editingRule}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  triggered: { bg: "bg-red-50", text: "text-red-700" },
  acknowledged: { bg: "bg-amber-50", text: "text-amber-700" },
  resolved: { bg: "bg-emerald-50", text: "text-emerald-700" },
};

function HistoryTab({ clientId }: { clientId: string }) {
  const { data: history, isLoading } = useAlertHistory(clientId);
  const evaluate = useEvaluateAlerts();
  const updateHistory = useUpdateAlertHistory();

  if (isLoading) return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-ink-muted">{history?.length || 0} alert{history?.length !== 1 ? "s" : ""} in history</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => evaluate.mutate(clientId)}
          disabled={evaluate.isPending}
          className="gap-1.5"
        >
          {evaluate.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          Run Check Now
        </Button>
      </div>

      {evaluate.data && (
        <div className={cn("rounded-lg border p-3 text-[13px]",
          evaluate.data.triggered?.length > 0
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-emerald-200 bg-emerald-50 text-emerald-800"
        )}>
          {evaluate.data.message}
        </div>
      )}

      {(!history || history.length === 0) ? (
        <div className="text-center py-12">
          <Check className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
          <p className="text-[13px] text-ink-muted">No alerts have been triggered yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-hairline overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-hairline">
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted h-9 pl-4">Date</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted h-9">Rule</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted h-9">Metric</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted h-9 text-right">Actual</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted h-9 text-right">Threshold</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted h-9">Severity</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted h-9">Status</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted h-9 pr-4">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((entry) => {
                const statusStyle = STATUS_STYLES[entry.status] || STATUS_STYLES.triggered;
                return (
                  <TableRow key={entry.id} className="border-hairline">
                    <TableCell className="text-[12px] text-ink-muted pl-4 tabular-nums">
                      {format(parseISO(entry.triggered_at), "MMM d, HH:mm")}
                    </TableCell>
                    <TableCell className="text-[13px] text-ink font-medium truncate max-w-[160px]">
                      {entry.rule_name || "—"}
                    </TableCell>
                    <TableCell className="text-[12px] text-ink-muted capitalize">{entry.metric}</TableCell>
                    <TableCell className="text-[13px] text-ink tabular-nums text-right">{Number(entry.actual_value).toFixed(2)}</TableCell>
                    <TableCell className="text-[13px] text-ink-muted tabular-nums text-right">{Number(entry.threshold_value).toFixed(2)}</TableCell>
                    <TableCell><SeverityBadge severity={entry.severity} /></TableCell>
                    <TableCell>
                      <span className={cn("inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium capitalize", statusStyle.bg, statusStyle.text)}>
                        {entry.status}
                      </span>
                    </TableCell>
                    <TableCell className="pr-4">
                      <div className="flex items-center gap-1">
                        {entry.status === "triggered" && (
                          <button
                            onClick={() => updateHistory.mutate({ id: entry.id, status: "acknowledged" })}
                            className="text-[11px] text-amber-700 hover:underline"
                          >
                            Ack
                          </button>
                        )}
                        {entry.status !== "resolved" && (
                          <button
                            onClick={() => updateHistory.mutate({
                              id: entry.id,
                              status: "resolved",
                              resolved_at: new Date().toISOString(),
                            })}
                            className="text-[11px] text-emerald-700 hover:underline"
                          >
                            Resolve
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export function AlertsManager() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const [tab, setTab] = useState<"rules" | "history">("rules");

  if (!clientId) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[300px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-[-0.5px] text-ink">Alerts & Notifications</h1>
        <p className="text-[13px] text-ink-muted mt-0.5">Configure metric-based alerts with email notifications</p>
      </div>

      <div className="flex items-center gap-1 bg-canvas-soft rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab("rules")}
          className={cn("px-3.5 py-1.5 rounded-md text-[13px] font-medium transition-colors",
            tab === "rules" ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink"
          )}
        >
          Rules
        </button>
        <button
          onClick={() => setTab("history")}
          className={cn("px-3.5 py-1.5 rounded-md text-[13px] font-medium transition-colors",
            tab === "history" ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink"
          )}
        >
          History
        </button>
      </div>

      {tab === "rules" ? <RulesTab clientId={clientId} /> : <HistoryTab clientId={clientId} />}
    </div>
  );
}
