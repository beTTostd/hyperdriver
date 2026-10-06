import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = readFileSync(new URL("../app/table/replay-table.tsx", import.meta.url), "utf8");
const component = source.slice(source.indexOf("function HeroCluster("), source.indexOf("function Hand("));
assert.ok(component.startsWith("function HeroCluster("));
const { outputText } = ts.transpileModule(component, {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
});
const HeroCluster = runInNewContext(`${outputText}\nHeroCluster`, {
  React,
  list: (cards) => cards ?? [],
  styles: new Proxy({}, { get: (_, key) => key }),
  Icon: () => null,
  CardView: ({ card }) => React.createElement("span", { "data-card": card?.cardNumber }),
});

for (const opponent of [false, true]) {
  for (const slot of ["Off-Hand", "RWep"]) {
    test(`renders ${slot} beside the ${opponent ? "opponent" : "player"} hero`, () => {
      const equipment = [
        { slot: "Hero", cardNumber: "test_hero" },
        { slot: "LWep", cardNumber: "test_weapon" },
        ...(slot === "Off-Hand" ? [{ slot: "RWep", cardNumber: "NONE00" }] : []),
        { slot, cardNumber: "test_shield" },
      ];
      const html = renderToStaticMarkup(React.createElement(HeroCluster, { equipment, opponent, health: 40 }));
      assert.match(html, /class="rightWeapon"><span data-card="test_shield"/);
      assert.match(html, /class="leftWeapon"><span data-card="test_weapon"/);
      assert.match(html, /data-card="test_hero"/);
      assert.doesNotMatch(html, /NONE00/);
    });
  }
}

test("leaves the off-hand position empty when no card is equipped", () => {
  const html = renderToStaticMarkup(React.createElement(HeroCluster, {
    equipment: [{ slot: "RWep", cardNumber: "NONE00" }], opponent: true,
  }));
  assert.match(html, /class="rightWeapon"><\/div>/);
});
