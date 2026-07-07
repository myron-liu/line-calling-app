import { LinesEditor } from "@/components/setup/lines-editor";

// Build/edit reusable saved lines & pods for the tournament's team (§4.3).
export default async function TournamentLinesPage({
  params,
}: {
  params: Promise<{ tournamentId: string }>;
}) {
  const { tournamentId } = await params;
  return <LinesEditor tournamentId={tournamentId} />;
}
