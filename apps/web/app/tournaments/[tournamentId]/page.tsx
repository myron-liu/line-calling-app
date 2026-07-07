import { TournamentDetail } from "@/components/setup/tournament-detail";

// Tournament detail (§16, §4.2): check-in roster, injuries, and games.
export default async function TournamentDetailPage({
  params,
}: {
  params: Promise<{ tournamentId: string }>;
}) {
  const { tournamentId } = await params;
  return <TournamentDetail tournamentId={tournamentId} />;
}
