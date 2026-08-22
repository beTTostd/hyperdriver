import { ReplayLibrary } from "../../replays/replay-library";
import { requireAdmin } from "../../../lib/auth";
import { listAdminReplays } from "../../../lib/replays";

export default async function AdminReplaysPage() {
  const currentUser = await requireAdmin("/admin/partidas");
  const replayList = await listAdminReplays();

  return (
    <ReplayLibrary
      currentUser={currentUser}
      replayList={replayList}
      title="Todas as partidas"
      emptyDescription="As partidas sincronizadas pelos usuários aparecerão aqui."
    />
  );
}
