import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { area, difference, featureCollection, intersect, union } from "@turf/turf";

const data = JSON.parse(
  await readFile(new URL("../public/data/site-geometry.json", import.meta.url), "utf8"),
);

const combine = (features) =>
  features.length === 1 ? features[0] : union(featureCollection(features));
const overlap = (a, b) => (a && b ? intersect(featureCollection([a, b])) : null);
const subtract = (a, b) => (!a ? null : b ? difference(featureCollection([a, b])) : a);

test("site geometry produces the confirmed weighted workable area", () => {
  const plant = combine(data.blocks.features);
  const exclusions = overlap(combine(data.exclusions.features), plant);
  const panels = subtract(overlap(combine(data.panels.features), plant), exclusions);
  const ordinary = subtract(subtract(plant, exclusions), panels);
  const workable = area(ordinary) + data.metadata.panelWeight * area(panels);

  assert.equal(data.metadata.panelWeight, 0.286);
  assert.ok(Math.abs(area(plant) / 10_000 - 32.183) < 0.01);
  assert.ok(Math.abs(area(exclusions) / 10_000 - 0.465) < 0.01);
  assert.ok(Math.abs(area(panels) / 10_000 - 26.666) < 0.02);
  assert.ok(Math.abs(workable / 10_000 - 12.678) < 0.02);
});

test("plant sections aggregate into exactly five blocks", () => {
  const blockIds = [...new Set(data.blocks.features.map((feature) => feature.properties.blockId))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  assert.deepEqual(blockIds, ["B1", "B2", "B3", "B4", "B5"]);
});

test("painting the entire plant reaches 100 percent of weighted work", () => {
  const plant = combine(data.blocks.features);
  const exclusions = overlap(combine(data.exclusions.features), plant);
  const panels = subtract(overlap(combine(data.panels.features), plant), exclusions);
  const ordinary = subtract(subtract(plant, exclusions), panels);
  const workable = area(ordinary) + data.metadata.panelWeight * area(panels);
  const completed =
    area(overlap(plant, ordinary)) + data.metadata.panelWeight * area(overlap(plant, panels));

  assert.ok(Math.abs((completed / workable) * 100 - 100) < 1e-6);
});
