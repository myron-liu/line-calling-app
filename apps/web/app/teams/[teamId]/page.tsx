import { TeamDetail } from "@/components/setup/team-detail";

// Team detail (§16, §4.1–4.3): roster, tournaments, and individual games.
export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  return <TeamDetail teamId={teamId} />;
}
