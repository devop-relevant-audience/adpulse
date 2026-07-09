import { TeamView } from "@/components/team/team-view";
import { RoleGate } from "@/components/layout/role-gate";

export default function Page() {
  return (
    <RoleGate require="admin">
      <TeamView />
    </RoleGate>
  );
}
