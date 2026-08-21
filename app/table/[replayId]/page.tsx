import { notFound } from "next/navigation";
import TalisharTable from "../../mesa/page";

const REPLAY_ID_PATTERN = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|\d+)$/i;

export default async function ReplayTablePage({
  params,
}: {
  params: Promise<{ replayId: string }>;
}) {
  const { replayId } = await params;
  if (!REPLAY_ID_PATTERN.test(replayId)) notFound();

  return <TalisharTable replayId={replayId} />;
}
