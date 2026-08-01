import { PlayerTagsEditor } from "@/components/setup/player-tags-editor";

// Quick player tagging for this tournament's roster (§ TournamentPlayerTags).
export default async function TournamentTagsPage({
  params,
}: {
  params: Promise<{ tournamentId: string }>;
}) {
  const { tournamentId } = await params;
  return <PlayerTagsEditor tournamentId={tournamentId} />;
}
