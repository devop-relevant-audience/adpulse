"use client";

import { useAppStore } from "@/store/app-store";
import { useClients } from "@/hooks/use-metrics";

/** The full `ClientRow` for the currently selected client, once `useClients()`
 * has resolved. Shares the `["clients"]` query cache with every other caller
 * (sidebar, layout guard), so this never triggers an extra fetch. */
export function useSelectedClient() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const { data: clients } = useClients();
  return clients?.find((c) => c.id === clientId);
}
