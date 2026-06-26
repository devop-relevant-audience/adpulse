"use client";

import { useState } from "react";
import { useAppStore } from "@/store/app-store";
import {
  useGeneratedReports,
  useReportSchedules,
  useCreateReportSchedule,
  useUpdateReportSchedule,
  useDeleteReportSchedule,
  useSendReportNow,
} from "@/hooks/use-metrics";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  FileText,
  Clock,
  Plus,
  Trash2,
  Send,
  X,
  Calendar,
  Loader2,
  Mail,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import type { ReportScheduleRow, ReportScheduleInsert, ScheduleFrequency, DateRangeType } from "@/lib/types/database";

const FREQUENCY_LABELS: Record<ScheduleFrequency, string> = {
  daily: "Daily", weekly: "Weekly", biweekly: "Biweekly",
  monthly: "Monthly", quarterly: "Quarterly",
};

const DATE_RANGE_LABELS: Record<DateRangeType, string> = {
  last_7: "Last 7 days", last_14: "Last 14 days", last_30: "Last 30 days",
  last_month: "Last month", last_quarter: "Last quarter",
  month_to_date: "Month to date", custom: "Custom days",
};

const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface ScheduleFormState {
  name: string;
  frequency: ScheduleFrequency;
  day_of_week: number | null;
  day_of_month: number | null;
  time_of_day: string;
  date_range_type: DateRangeType;
  custom_days: number | null;
  include_comparison: boolean;
  recipients: string[];
  subject_template: string;
  message_template: string;
  require_approval: boolean;
  enabled: boolean;
}

const DEFAULT_FORM: ScheduleFormState = {
  name: "",
  frequency: "weekly",
  day_of_week: 1,
  day_of_month: 1,
  time_of_day: "09:00",
  date_range_type: "last_30",
  custom_days: 60,
  include_comparison: true,
  recipients: [],
  subject_template: "{{clientName}} Performance Report — {{dateRange}}",
  message_template: "",
  require_approval: false,
  enabled: true,
};

function ScheduleForm({
  clientId,
  initial,
  onClose,
}: {
  clientId: string;
  initial?: ReportScheduleRow;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ScheduleFormState>(() => {
    if (initial) {
      return {
        name: initial.name,
        frequency: initial.frequency,
        day_of_week: initial.day_of_week,
        day_of_month: initial.day_of_month,
        time_of_day: initial.time_of_day,
        date_range_type: initial.date_range_type,
        custom_days: initial.custom_days,
        include_comparison: initial.include_comparison,
        recipients: initial.recipients,
        subject_template: initial.subject_template,
        message_template: initial.message_template,
        require_approval: initial.require_approval,
        enabled: initial.enabled,
      };
    }
    return { ...DEFAULT_FORM };
  });
  const [emailInput, setEmailInput] = useState("");
  const createSchedule = useCreateReportSchedule();
  const updateSchedule = useUpdateReportSchedule();

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
      await updateSchedule.mutateAsync({ id: initial.id, ...form });
    } else {
      await createSchedule.mutateAsync({ ...form, client_id: clientId } as ReportScheduleInsert);
    }
    onClose();
  }

  const isBusy = createSchedule.isPending || updateSchedule.isPending;
  const showDayOfWeek = form.frequency === "weekly" || form.frequency === "biweekly";
  const showDayOfMonth = form.frequency === "monthly" || form.frequency === "quarterly";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-2xl border border-hairline shadow-xl w-full max-w-[560px] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
          <h2 className="text-[15px] font-semibold text-ink">
            {initial ? "Edit Schedule" : "Schedule New Report"}
          </h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-[11px] font-medium text-ink-muted uppercase tracking-wider block mb-1.5">Schedule Name</label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Weekly Client Report" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-ink-muted uppercase tracking-wider block mb-1.5">Frequency</label>
              <Select value={form.frequency} onValueChange={(v) => { if (v) setForm((f) => ({ ...f, frequency: v as ScheduleFrequency })); }}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(FREQUENCY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-ink-muted uppercase tracking-wider block mb-1.5">Time of Day</label>
              <Input type="time" value={form.time_of_day} onChange={(e) => setForm((f) => ({ ...f, time_of_day: e.target.value }))} className="h-9" />
            </div>
          </div>

          {showDayOfWeek && (
            <div>
              <label className="text-[11px] font-medium text-ink-muted uppercase tracking-wider block mb-1.5">Day of Week</label>
              <Select value={String(form.day_of_week ?? 1)} onValueChange={(v) => { if (v) setForm((f) => ({ ...f, day_of_week: parseInt(v) })); }}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DAYS_OF_WEEK.map((day, i) => <SelectItem key={i} value={String(i)}>{day}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {showDayOfMonth && (
            <div>
              <label className="text-[11px] font-medium text-ink-muted uppercase tracking-wider block mb-1.5">Day of Month</label>
              <Input
                type="number"
                min={1}
                max={31}
                value={form.day_of_month ?? 1}
                onChange={(e) => setForm((f) => ({ ...f, day_of_month: parseInt(e.target.value) || 1 }))}
                className="h-9"
              />
              <p className="text-[11px] text-ink-muted mt-1">Use 31 for last day of month</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-ink-muted uppercase tracking-wider block mb-1.5">Report Date Range</label>
              <Select value={form.date_range_type} onValueChange={(v) => { if (v) setForm((f) => ({ ...f, date_range_type: v as DateRangeType })); }}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DATE_RANGE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {form.date_range_type === "custom" && (
              <div>
                <label className="text-[11px] font-medium text-ink-muted uppercase tracking-wider block mb-1.5">Custom Days Back</label>
                <Input type="number" min={1} value={form.custom_days ?? 30} onChange={(e) => setForm((f) => ({ ...f, custom_days: parseInt(e.target.value) || 30 }))} className="h-9" />
              </div>
            )}
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

          <div>
            <label className="text-[11px] font-medium text-ink-muted uppercase tracking-wider block mb-1.5">Email Subject</label>
            <Input value={form.subject_template} onChange={(e) => setForm((f) => ({ ...f, subject_template: e.target.value }))} />
            <p className="text-[11px] text-ink-muted mt-1">Use {"{{clientName}}"} and {"{{dateRange}}"} as placeholders</p>
          </div>

          <div>
            <label className="text-[11px] font-medium text-ink-muted uppercase tracking-wider block mb-1.5">Email Message (optional)</label>
            <Textarea
              value={form.message_template}
              onChange={(e) => setForm((f) => ({ ...f, message_template: e.target.value }))}
              rows={3}
              placeholder="Custom message to include in the email body..."
            />
          </div>

          <div className="flex flex-col gap-2.5 pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.include_comparison} onChange={(e) => setForm((f) => ({ ...f, include_comparison: e.target.checked }))} className="rounded border-hairline" />
              <span className="text-[13px] text-ink">Include period-over-period comparison</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.require_approval} onChange={(e) => setForm((f) => ({ ...f, require_approval: e.target.checked }))} className="rounded border-hairline" />
              <span className="text-[13px] text-ink">Require approval before sending</span>
              <span className="text-[11px] text-ink-muted">(review report before delivery)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} className="rounded border-hairline" />
              <span className="text-[13px] text-ink">Enabled</span>
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-hairline">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isBusy || !form.name || form.recipients.length === 0}>
            {isBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
            {initial ? "Save Changes" : "Create Schedule"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ReportsView() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const [tab, setTab] = useState<"reports" | "schedules">("reports");
  const [showForm, setShowForm] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ReportScheduleRow | undefined>();

  const { data: reports, isLoading: reportsLoading } = useGeneratedReports(clientId);
  const { data: schedules, isLoading: schedulesLoading } = useReportSchedules(clientId);
  const updateSchedule = useUpdateReportSchedule();
  const deleteSchedule = useDeleteReportSchedule();
  const sendNow = useSendReportNow();

  if (!clientId) {
    return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-[300px] w-full" /></div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-[-0.5px] text-ink">Reports</h1>
        <p className="text-[13px] text-ink-muted mt-0.5">Generated reports and scheduled email deliveries</p>
      </div>

      <div className="flex items-center gap-1 bg-canvas-soft rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab("reports")}
          className={cn("px-3.5 py-1.5 rounded-md text-[13px] font-medium transition-colors",
            tab === "reports" ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink"
          )}
        >
          Generated Reports
        </button>
        <button
          onClick={() => setTab("schedules")}
          className={cn("px-3.5 py-1.5 rounded-md text-[13px] font-medium transition-colors",
            tab === "schedules" ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink"
          )}
        >
          Scheduled Deliveries
        </button>
      </div>

      {tab === "reports" && (
        <div className="space-y-3">
          {reportsLoading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          {!reportsLoading && (!reports || reports.length === 0) && (
            <div className="text-center py-12">
              <FileText className="w-10 h-10 text-ink-muted/40 mx-auto mb-3" />
              <p className="text-[13px] text-ink-muted">No reports generated yet.</p>
              <p className="text-[12px] text-ink-muted mt-1">Use the Export Report button on the dashboard to generate one.</p>
            </div>
          )}
          {reports?.map((report) => (
            <div key={report.id} className="bg-white rounded-xl border border-hairline p-4 flex items-center gap-4">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-[14px] font-medium text-ink truncate">{report.title}</h4>
                <p className="text-[12px] text-ink-muted">
                  {format(parseISO(report.date_range_start), "MMM d")} — {format(parseISO(report.date_range_end), "MMM d, yyyy")}
                  {" "}&middot;{" "}Generated {format(parseISO(report.created_at), "MMM d, yyyy")}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "schedules" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-ink-muted">{schedules?.length || 0} schedule{schedules?.length !== 1 ? "s" : ""}</p>
            <Button size="sm" onClick={() => { setEditingSchedule(undefined); setShowForm(true); }} className="gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Schedule New Report
            </Button>
          </div>

          {schedulesLoading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}

          {!schedulesLoading && (!schedules || schedules.length === 0) && (
            <div className="text-center py-12">
              <Clock className="w-10 h-10 text-ink-muted/40 mx-auto mb-3" />
              <p className="text-[13px] text-ink-muted">No scheduled deliveries yet.</p>
              <p className="text-[12px] text-ink-muted mt-1">Set up automated report emails for your clients.</p>
            </div>
          )}

          {schedules?.map((schedule) => (
            <div key={schedule.id} className="bg-white rounded-xl border border-hairline p-4 flex items-start gap-4">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Mail className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="text-[14px] font-medium text-ink truncate">{schedule.name}</h4>
                  <Badge variant="outline" className="text-[10px] capitalize">{schedule.frequency}</Badge>
                  {!schedule.enabled && <Badge variant="outline" className="text-[10px]">Paused</Badge>}
                  {schedule.require_approval && <Badge variant="outline" className="text-[10px] border-amber-200 text-amber-700">Approval Required</Badge>}
                </div>
                <p className="text-[12px] text-ink-muted">
                  {DATE_RANGE_LABELS[schedule.date_range_type]}
                  {" "}&middot;{" "}{schedule.time_of_day}
                  {schedule.day_of_week !== null && schedule.day_of_week !== undefined && (schedule.frequency === "weekly" || schedule.frequency === "biweekly")
                    ? ` · ${DAYS_OF_WEEK[schedule.day_of_week]}`
                    : ""}
                  {schedule.day_of_month && (schedule.frequency === "monthly" || schedule.frequency === "quarterly")
                    ? ` · Day ${schedule.day_of_month}`
                    : ""}
                </p>
                <p className="text-[11px] text-ink-muted mt-0.5">
                  <Calendar className="w-3 h-3 inline mr-1" />
                  {schedule.recipients.length} recipient{schedule.recipients.length !== 1 ? "s" : ""}
                  {schedule.last_sent_at
                    ? ` · Last sent ${format(parseISO(schedule.last_sent_at), "MMM d, HH:mm")}`
                    : " · Never sent"}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => updateSchedule.mutate({ id: schedule.id, enabled: !schedule.enabled })}
                  className={cn("w-8 h-5 rounded-full transition-colors relative", schedule.enabled ? "bg-primary" : "bg-ink-muted/30")}
                >
                  <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform", schedule.enabled ? "left-3.5" : "left-0.5")} />
                </button>
                <Button
                  variant="outline"
                  size="icon"
                  className="w-8 h-8"
                  onClick={() => sendNow.mutate(schedule.id)}
                  disabled={sendNow.isPending}
                  title="Send now"
                >
                  {sendNow.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                </Button>
                <button
                  onClick={() => { setEditingSchedule(schedule); setShowForm(true); }}
                  className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-canvas-soft"
                >
                  <FileText className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => deleteSchedule.mutate(schedule.id)}
                  className="p-1.5 rounded-md text-ink-muted hover:text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}

          {sendNow.isSuccess && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[13px] text-emerald-800">
              Report sent successfully (mock). Check server console for email details.
            </div>
          )}
        </div>
      )}

      {showForm && (
        <ScheduleForm
          clientId={clientId}
          initial={editingSchedule}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}
