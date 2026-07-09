import { DashboardSkeleton } from "@/components/layout/dashboard-skeleton";

// Route-level fallback shown during view navigation transitions. It renders
// inside the persistent [clientId] shell (sidebar/header stay put).
export default function Loading() {
  return <DashboardSkeleton />;
}
