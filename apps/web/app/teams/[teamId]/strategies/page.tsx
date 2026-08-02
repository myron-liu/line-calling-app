import { StrategyEditor } from "@/components/setup/strategy-editor";

// The team's named strategies (§ strategy tags) — the vocabulary offered when
// tagging a point in the live caller.
export default async function TeamStrategiesPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  return <StrategyEditor teamId={teamId} />;
}
