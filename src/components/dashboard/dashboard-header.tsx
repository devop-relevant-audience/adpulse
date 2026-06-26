"use client";

import { DateRangePicker } from "./date-range-picker";
import { PlatformFilter } from "./platform-filter";
import { ReportGenerator } from "@/components/report/report-generator";
import { useAppStore } from "@/store/app-store";
import { useClients } from "@/hooks/use-metrics";

export function DashboardHeader() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const { data: clients } = useClients();
  const selectedClient = clients?.find((c) => c.id === clientId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.5px] text-ink">
            {selectedClient ? `${selectedClient.name}` : "Dashboard"}
          </h1>
          <p className="text-[13px] text-ink-muted mt-0.5">
            Cross-platform advertising performance
          </p>
        </div>
        <ReportGenerator />
      </div>

      <div className="flex items-center gap-2.5 flex-wrap">
        <DateRangePicker />
        <div className="h-5 w-px bg-hairline mx-1" />
        <PlatformFilter />
      </div>
    </div>
  );
}
