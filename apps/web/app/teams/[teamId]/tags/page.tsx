import { PlayerTagsEditor } from "@/components/setup/player-tags-editor";

// Quick player tagging for the team's roster (§ Player.tags).
export default async function TeamTagsPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  return <PlayerTagsEditor teamId={teamId} />;
}
