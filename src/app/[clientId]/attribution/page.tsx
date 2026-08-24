import { AttributionView } from "@/components/dashboard/attribution-view";
import { DemoOnlyGate } from "@/components/dashboard/demo-only";

export default function Page() {
  return (
    <DemoOnlyGate description="Blended ROAS, multi-touch attribution, and LTV cohorts require a ground-truth revenue feed and cross-platform journey data that aren't connected for live clients yet.">
      <AttributionView />
    </DemoOnlyGate>
  );
}
