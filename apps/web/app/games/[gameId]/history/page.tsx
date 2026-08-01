import { GameLineHistory } from "@/components/game/game-line-history";

// Opened in its own tab from the live caller (§ line history).
export default async function GameHistoryPage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  return <GameLineHistory gameId={gameId} />;
}
