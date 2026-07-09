import { AlertsManager } from "@/components/dashboard/alerts-manager";
import { RoleGate } from "@/components/layout/role-gate";

export default function Page() {
  return (
    <RoleGate require="agency">
      <AlertsManager />
    </RoleGate>
  );
}
