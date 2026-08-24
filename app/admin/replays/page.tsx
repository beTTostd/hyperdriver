import { ReplayLibrary } from "../../replays/replay-library";
import { requireAdmin } from "../../../lib/auth";
import { listAdminReplays } from "../../../lib/replays";

export default async function AdminReplaysPage({
  searchParams,
}: {
  searchParams?: Promise<{ cursor?: string | string[] }>;
}) {
  const currentUser = await requireAdmin("/admin/replays");
  const query = searchParams ? await searchParams : {};
  const cursor = Array.isArray(query.cursor) ? query.cursor[0] : query.cursor;
  const replayPage = await listAdminReplays(cursor);

  return (
    <ReplayLibrary
      currentUser={currentUser}
      replayList={replayPage.items}
      nextCursor={replayPage.nextCursor}
      paginationPath="/admin/replays"
      title="Todas as partidas"
      emptyDescription="As partidas sincronizadas pelos usuários aparecerão aqui."
    />
  );
}
