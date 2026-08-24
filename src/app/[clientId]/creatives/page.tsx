import { CreativeGallery } from "@/components/dashboard/creative-gallery";
import { DemoOnlyGate } from "@/components/dashboard/demo-only";

export default function Page() {
  return (
    <DemoOnlyGate description="Creative-level performance requires per-ad ingestion from each platform that isn't connected for live clients yet.">
      <CreativeGallery />
    </DemoOnlyGate>
  );
}
