import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {area} from '@turf/turf';
import {segmentRow,sumTables,selectionUnits} from '../lib/panel-geometry.ts';
import {panelMetrics,validateProject,isISODate,panelDatabaseName} from '../lib/panel-project.ts';
import {defaultReporting,targetWindow} from '../lib/reporting.ts';
const read=async name=>JSON.parse(await readFile(new URL(`../public/panel-cleaning/${name}`,import.meta.url),'utf8'));
const rows=await read('rows.json'),tables=await read('tables.json'),calibration=await read('calibration.json');
const reference=await read('calibration-reference.json');
const pitch=rows.metadata.fullTableMeters;
const expected=new Map((await readFile(new URL('../public/panel-cleaning/trial_kml.csv',import.meta.url),'utf8')).replace(/^\uFEFF/,'').trim().split(/\r?\n/).slice(1).map(line=>{const [row,count]=line.split(',');return[row,Number(count)];}));

test('all five blocks load; the empty Block 2 polygon is excluded with a warning',()=>{
 assert.deepEqual(rows.metadata.blocks.map(b=>[b.block,b.rows]),[['B1',150],['B2',119],['B3',93],['B4',85],['B5',52]]);
 assert.equal(rows.features.length,499);assert.equal(rows.metadata.warnings.length,1);
 assert.match(rows.metadata.warnings[0],/blk2\(1\).kml: polygon 16/);
 assert.deepEqual(rows.metadata.blocks.map(b=>b.sourceFiles),[['block1.kml'],['blk2(1).kml'],Array.from({length:7},(_,i)=>`blk3_${i+1}.kml`),['blk4.kml'],['block5.kml']]);
});
test('all actual block counts match geometry at the corrected physical table length',()=>{
 assert.equal(pitch,16.335);assert.equal(rows.metadata.tableIncrement,.25);
 assert.deepEqual(rows.metadata.blocks.map(b=>[b.block,b.actualTables]),[['B1',684],['B2',684],['B3',684],['B4',502],['B5',319]]);
 for(const b of rows.metadata.blocks)assert.equal(sumTables(tables.features.filter(f=>f.properties.block===b.block)),b.actualTables,b.block);
});
test('all 17 legacy samples convert to twice their original table counts',()=>{
 assert.equal(calibration.features.length,17);
 assert.equal(reference.legacyCountMultiplier,2);
 for(const sample of calibration.features){sample.properties.id=sample.properties.row;const split=segmentRow(sample,pitch);assert.equal(sumTables(split),expected.get(sample.properties.row)*reference.legacyCountMultiplier,sample.properties.row);}
});
test('quarter polygons preserve the row area and produce unique stable IDs',()=>{
 const grouped=new Map();for(const f of tables.features){const id=f.properties.rowId;if(!grouped.has(id))grouped.set(id,[]);grouped.get(id).push(f);}
 assert.equal(new Set(tables.features.map(f=>f.properties.id)).size,tables.features.length);
 assert.equal(sumTables(tables.features),2873);assert.equal(tables.features.length,11492);
 for(const row of rows.features){const pieces=grouped.get(row.properties.id);assert.ok(pieces?.length);const combined=pieces.reduce((sum,f)=>sum+area(f),0);assert.ok(Math.abs(combined-area(row))/area(row)<0.000001,`${row.properties.row} area mismatch`);assert.ok(pieces.every(f=>f.properties.weight===.25));}
});
test('actual quarter, half, three-quarter and whole table selections use corrected geometry',()=>{
 const sample=calibration.features.find(f=>f.properties.row==='R001');
 const fs=segmentRow(sample,pitch),ids=fs.map(f=>f.properties.id);
 assert.equal(fs.length,8); // The former one-table sample is two actual tables.
 assert.equal(sumTables(selectionUnitsFeatures('quarter',[ids[0]])),.25);
 assert.equal(sumTables(selectionUnitsFeatures('half',[ids[0]])),.5);
 assert.equal(sumTables(selectionUnitsFeatures('quarter',ids.slice(0,3))),.75);
 assert.equal(sumTables(selectionUnitsFeatures('table',[ids[0]])),1);
 assert.equal(sumTables(selectionUnitsFeatures('table',[ids[4]])),1);
 assert.equal(selectionUnits(fs,new Set(ids.slice(0,3)),'table',true).size,0);
 assert.equal(selectionUnits(fs,new Set(ids.slice(0,3)),'half',true).size,2);
 assert.equal(selectionUnits(fs,new Set(ids.slice(0,4)),'table',true).size,4);
 // Two new quarters cover the old quarter exactly, even for a tapered trace.
 const old=segmentRow(sample,32.67);
 assert.ok(Math.abs((area(fs[0])+area(fs[1]))/area(old[0])-1)<1e-6);
 function selectionUnitsFeatures(precision,matched){const selected=selectionUnits(fs,new Set(matched),precision);return fs.filter(f=>selected.has(f.properties.id));}
});
test('fractional row ends and ring winding preserve counts and table numbering',()=>{
 const row=rows.features.find(row=>segmentRow(row,pitch)[0].properties.estimatedTables%1===.5);
 const fs=segmentRow(row,pitch),last=fs.at(-1),selected=selectionUnits(fs,new Set([last.properties.id]),'table');
 assert.equal(sumTables(fs.filter(f=>selected.has(f.properties.id))),.5);
 const reversed={...row,geometry:{...row.geometry,coordinates:row.geometry.coordinates.map(r=>[...r].reverse())}};
 assert.deepEqual(segmentRow(reversed,pitch).map(f=>f.properties.id),fs.map(f=>f.properties.id));
 assert.throws(()=>segmentRow(row,0),/positive/);
});
test('completion uses unique weighted quarters, selected dates, and target intersection',()=>{
 const fs=tables.features.slice(0,8),ids=fs.map(f=>f.properties.id);
 const round={id:'test',label:'test',completed:{[ids[0]]:'2026-10-01',[ids[1]]:'2026-09-30',[ids[2]]:'2026-10-01'},targets:{}};
 const metrics=panelMetrics(fs,round,'2026-10-01','2026-10-01',[ids[0],ids[1],ids[3]]).total;
 assert.equal(metrics.tables,2);assert.equal(metrics.completed,.5);assert.equal(metrics.target,.75);assert.equal(metrics.targetCompleted,.25);
 assert.equal(panelMetrics(fs,{...round,completed:{}},'2026-10-01','2026-10-31').total.completed,0);
});
test('backup validation rejects incompatible geometry, unknown quarters, and invalid dates',()=>{
 const details={title:'Panel report',reportDate:'2026-10-01',preparedBy:'',team:'ZEPDI',remarks:''};
 const p={id:'current',version:1,kind:'panel-cleaning',datasetId:rows.metadata.datasetId,pitch,rounds:[{id:'r1',label:'Q4',completed:{},targets:{}}],activeRoundId:'r1',reporting:defaultReporting(details),details,workDate:'2026-10-01',rangeStart:'2026-10-01',rangeEnd:'2026-10-31',imageryId:'current',updatedAt:''};
 const ids=new Set(tables.features.map(f=>f.properties.id));
 assert.equal(validateProject(p,rows.metadata.datasetId,ids,pitch).activeRoundId,'r1');
 assert.throws(()=>validateProject({...p,datasetId:'different'},rows.metadata.datasetId,ids,pitch),/differs/);
 assert.throws(()=>validateProject({...p,pitch:32.67},rows.metadata.datasetId,ids,pitch),/differs/);
 assert.notEqual(panelDatabaseName(p.datasetId),panelDatabaseName('previous-dataset'));
 assert.notEqual(panelDatabaseName(p.datasetId),'armenia-panel-cleaning');
 assert.throws(()=>validateProject({...p,rounds:[{...p.rounds[0],completed:{unknown:'2026-10-01'}}]},rows.metadata.datasetId,ids,pitch),/unknown table/);
 assert.equal(isISODate('2026-02-30'),false);assert.equal(isISODate('2026-13-01'),false);assert.equal(isISODate('2026-10-01'),true);
 assert.deepEqual(targetWindow('weekly','2026-10-01'),{start:'2026-09-28',end:'2026-10-04',key:'weekly:2026-09-28'});
});
