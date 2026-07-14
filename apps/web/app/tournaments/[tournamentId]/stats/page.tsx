import { TournamentStats } from "@/components/setup/tournament-stats";

// Aggregated player stats across every game in the tournament (§4.2).
export default async function TournamentStatsPage({
  params,
}: {
  params: Promise<{ tournamentId: string }>;
}) {
  const { tournamentId } = await params;
  return <TournamentStats tournamentId={tournamentId} />;
}
