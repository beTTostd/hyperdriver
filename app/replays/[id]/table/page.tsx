import { notFound } from "next/navigation";
import TalisharTable from "../../../table/replay-table";
import { requireUser } from "../../../../lib/auth";
import { findAdminReplay, findUserReplay } from "../../../../lib/replays";

const REPLAY_ID_PATTERN = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|\d+)$/i;

export default async function ReplayTablePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!REPLAY_ID_PATTERN.test(id)) notFound();
  const currentUser = await requireUser(`/replays/${id}/table`);
  const replay = currentUser.role === "admin"
    ? findAdminReplay(id)
    : findUserReplay(currentUser.id, id);
  if (!replay) notFound();

  return <TalisharTable replayId={id} />;
}
