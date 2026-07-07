import { GameScreen } from "@/components/game/game-screen";

// Game route (§16). Renders lobby / live caller / recap based on Game.status.
export default async function GamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  return <GameScreen gameId={gameId} />;
}
