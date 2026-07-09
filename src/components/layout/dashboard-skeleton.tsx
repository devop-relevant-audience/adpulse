import { Skeleton } from "@/components/ui/skeleton";
import { Panel } from "@/components/ui/panel";

/**
 * Generic loading placeholder for a dashboard view. Used by the route-level
 * `loading.tsx`, the `[clientId]` layout gates, and the root redirect while the
 * URL → store sync settles.
 */
export function DashboardSkeleton() {
  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-9 w-64" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Panel key={i} className="p-5 space-y-2">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-3 w-16" />
          </Panel>
        ))}
      </div>
      <Panel className="p-5">
        <Skeleton className="h-[340px] w-full" />
      </Panel>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel className="p-5">
          <Skeleton className="h-[200px] w-full" />
        </Panel>
        <Panel className="p-5">
          <Skeleton className="h-[200px] w-full" />
        </Panel>
        <Panel className="p-5">
          <Skeleton className="h-[200px] w-full" />
        </Panel>
      </div>
      <Panel className="p-5">
        <Skeleton className="h-[200px] w-full" />
      </Panel>
    </div>
  );
}

/** Full-page centered skeleton for pre-shell states (identity/client loading). */
export function FullPageSkeleton() {
  return (
    <div className="min-h-screen bg-background px-8 py-6">
      <div className="max-w-[1400px] mx-auto">
        <DashboardSkeleton />
      </div>
    </div>
  );
}
