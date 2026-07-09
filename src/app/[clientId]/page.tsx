import { redirect } from "next/navigation";

// A bare `/[clientId]` has no view of its own — send it to the dashboard.
export default async function ClientIndex({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  redirect(`/${clientId}/dashboard`);
}
