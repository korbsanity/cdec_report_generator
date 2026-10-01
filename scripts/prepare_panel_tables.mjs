// node --import tsx scripts/prepare_panel_tables.mjs
import {readFile,writeFile} from 'node:fs/promises';
import {segmentRow,sumTables} from '../lib/panel-geometry.ts';
const input=new URL('../public/panel-cleaning/rows.json',import.meta.url);
const rows=JSON.parse(await readFile(input,'utf8'));
const features=rows.features.flatMap(row=>segmentRow(row,rows.metadata.fullTableMeters));
// Verify the geometry itself reproduces the supplied counts. Never conceal
// a mismatch by scaling progress weights or replacing computed totals.
for(const block of rows.metadata.blocks){
  const computed=sumTables(features.filter(f=>f.properties.block===block.block));
  if(computed!==block.actualTables)throw new Error(`${block.block}: geometry gives ${computed}, expected ${block.actualTables}. Review tracing/calibration.`);
}
await writeFile(new URL('../public/panel-cleaning/tables.json',import.meta.url),JSON.stringify({type:'FeatureCollection',features,metadata:rows.metadata}));
console.log(`${rows.features.length} rows; ${features.length} quarter sections; ${sumTables(features)} tables; all five actual block totals match.`);
