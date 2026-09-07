import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const tableSource = readFileSync(
  fileURLToPath(new URL("../app/table/replay-table.tsx", import.meta.url)),
  "utf8",
);
const tableStyles = readFileSync(
  fileURLToPath(new URL("../app/table/replay-table.module.css", import.meta.url)),
  "utf8",
);
const playerActionsSource = readFileSync(
  fileURLToPath(new URL("../app/table/replay-player-actions.tsx", import.meta.url)),
  "utf8",
);
const replayTablePageSource = readFileSync(
  fileURLToPath(new URL("../app/replays/[id]/table/page.tsx", import.meta.url)),
  "utf8",
);

test("keeps the replay player transport focused on four ordered controls", () => {
  const transport = tableSource.match(
    /<div className=\{styles\.transport\}>([\s\S]*?)<\/div>/,
  )?.[1] ?? "";

  const labels = [...transport.matchAll(/aria-label=(?:"([^"]+)"|\{playing \? "([^"]+)" : "([^"]+)"\})/g)]
    .flatMap((match) => match.slice(1).filter(Boolean));

  assert.deepEqual(labels, ["Voltar", "Frame anterior", "Pausar", "Reproduzir", "Próximo frame"]);
  assert.doesNotMatch(transport, /Primeiro snapshot|\u00daltimo snapshot|Criar bookmark|Compartilhar com treinador/);
  assert.match(transport, /disabled=\{index === 0\}/);
  assert.match(transport, /disabled=\{index === frames\.length - 1\}/);
});

test("places note and sharing actions to the right of the player and opens their settings in modals", () => {
  assert.match(playerActionsSource, /<div className=\{styles\.playerActions\} aria-label="Ações do replay">/);
  assert.match(playerActionsSource, /title="Tomar nota"/);
  assert.match(playerActionsSource, /title="Compartilhar"/);
  assert.match(playerActionsSource, /role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-labelledby=\{modalTitleId\}/);
  assert.match(playerActionsSource, /fetch\(`\/api\/replays\/\$\{replayId\}\/bookmarks`/);
  assert.match(playerActionsSource, /body: JSON\.stringify\(\{ frameIndex: noteFrameIndex, title: noteTitle, note \}\)/);
  assert.match(playerActionsSource, /fetch\(`\/api\/replays\/\$\{replayId\}\/shares`/);
  assert.match(playerActionsSource, /const defaultCoachName = "Treinador";/);
  assert.match(playerActionsSource, /setCoachName\(defaultCoachName\)/);
  assert.match(playerActionsSource, /includeAnalysis: "Análise"[\s\S]*includeBookmarks: "Notas por frame"/);
  assert.match(tableStyles, /\.timelineWithActions \{ grid-template-columns: 150px minmax\(0,1fr\) 58px auto; \}/);
  assert.match(tableStyles, /\.playerActions \{[^}]*justify-self: end;/);
  assert.match(replayTablePageSource, /workspaceEnabled=\{replay\.userId === currentUser\.id\}/);
  assert.match(tableSource, /onOpen=\{\(\) => setPlaying\(false\)\}/);
});
