import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cardMarkers,
  fullCardImageUrl,
  markerSummary,
  squareCardImageUrl,
} from "../app/mesa/card-presentation.js";

test("builds square and full Talishar image URLs safely", () => {
  assert.equal(
    squareCardImageUrl("dash io"),
    "https://images.talishar.net/public/cardsquares/english/dash%20io.webp",
  );
  assert.equal(
    fullCardImageUrl("dash_io"),
    "https://images.talishar.net/public/cardimages/english/dash_io.webp",
  );
});

test("normalizes, orders and describes card markers", () => {
  const markers = cardMarkers({
    counters: 9,
    countersMap: { steam: "3", customCharge: 2, defense: -1, attack: 0 },
  });

  assert.deepEqual(markers, [
    { key: "defense", value: -1, label: "Defesa", abbreviation: "DEF", kind: "defense" },
    { key: "steam", value: 3, label: "Steam", abbreviation: "STM", kind: "steam" },
    { key: "customCharge", value: 2, label: "Custom Charge", abbreviation: "CC", kind: "generic" },
  ]);
  assert.equal(markerSummary(markers), "Defesa: -1, Steam: 3, Custom Charge: 2");
});

test("uses the legacy counter only when the counter map has no visible value", () => {
  assert.deepEqual(cardMarkers({ counters: "2", countersMap: { steam: 0 } }), [
    { key: "counters", value: 2, label: "Contadores", abbreviation: "CTR", kind: "generic" },
  ]);
  assert.deepEqual(cardMarkers({ counters: 2, countersMap: { steam: 1 } }).map(({ key, value }) => ({ key, value })), [
    { key: "steam", value: 1 },
  ]);
});

test("ignores zero and non-numeric marker values", () => {
  assert.deepEqual(cardMarkers({ counters: 0, countersMap: { steam: "nope", defense: 0 } }), []);
});
