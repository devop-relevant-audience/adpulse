"use client";

import { useAppStore } from "@/store/app-store";
import { useCurrentUser } from "@/hooks/use-current-user";
import { isAgencyRole } from "@/lib/auth/roles";
import { useDashboardStore } from "@/store/dashboard-store";
import { CustomizableDashboard } from "@/components/dashboard/customizable-dashboard";
import { MasterTemplateEditor } from "@/components/templates/master-template-editor";

// The dashboard route's root: either the client's own view or the master
// template editor, never both mounted at once.
//
// The swap lives HERE rather than inside `CustomizableDashboard` because
// react-grid-layout 2.x measures its container (and attaches its
// ResizeObserver) in a mount-only effect. Returning the editor from inside the
// dashboard would keep that component instance mounted, so coming back would
// render a grid div the observer never sees — a stale width that no longer
// responds to a window resize. Unmounting the dashboard outright gives each
// grid its own mount.

export function DashboardView() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const editingMaster = useDashboardStore((s) => s.editingMasterTemplate);
  const setEditingMaster = useDashboardStore((s) => s.setEditingMasterTemplate);
  const { data: me } = useCurrentUser();
  // The templates API is agency-only, so a client_user never reaches the editor
  // even if the flag were somehow set.
  const canEdit = isAgencyRole(me?.profile.role);

  if (canEdit && editingMaster && clientId) {
    return (
      <MasterTemplateEditor
        kind="dashboard"
        clientId={clientId}
        onBack={() => setEditingMaster(false)}
      />
    );
  }

  return <CustomizableDashboard />;
}
