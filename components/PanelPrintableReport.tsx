import {Header,Signatures} from './PrintableReport';
import type {PanelProject,CleaningRound} from '@/lib/panel-project';
import {panelMetrics} from '@/lib/panel-project';
import type {QuarterFeature} from '@/lib/panel-geometry';
import {displayDate,targetWindow} from '@/lib/reporting';
import {imageryAttribution,type ReportMapResult} from '@/lib/report-map';

/* eslint-disable @next/next/no-img-element -- printable locally generated maps and photos. */
export default function PanelPrintableReport({project,round,features,overview,latest,imageryLabel}:{project:PanelProject;round:CleaningRound;features:QuarterFeature[];overview:ReportMapResult;latest:ReportMapResult|null;imageryLabel:string}){
  const p=project, period=targetWindow(p.reporting.targetPeriod,p.details.reportDate),target=round.targets[period.key];
  const summary=panelMetrics(features,round,p.rangeStart,p.rangeEnd,target?.ids);
  const achievement=panelMetrics(features,round,period.start,p.details.reportDate,target?.ids).total;
  const dates=Object.values(round.completed).filter(d=>d>=p.rangeStart&&d<=p.rangeEnd).sort();const latestDate=dates.at(-1)||'';
  const latestCount=features.filter(f=>round.completed[f.properties.id]===latestDate).length/4;
  const pairs=p.reporting.photos.filter(pair=>pair.before||pair.after);
  return <article className="print-report">
    <section className="report-sheet summary-sheet"><Header details={p.details} round={round.label}/>
      <div className="revision-report-meta"><span><b>Contractor:</b> {p.details.team}</span><span><b>Coverage:</b> {displayDate(p.rangeStart)}–{displayDate(p.rangeEnd)}</span><span><b>Imagery:</b> {imageryLabel}</span></div>
      <section className="report-target-strip"><div><span>{p.reporting.targetPeriod} target</span><strong>{achievement.target.toFixed(2)} tables</strong><small>{displayDate(period.start)}–{displayDate(period.end)}</small></div><div><span>Completed inside target</span><strong>{achievement.targetCompleted.toFixed(2)} tables</strong><small>Through {displayDate(p.details.reportDate)}</small></div><div><span>Target achievement</span><strong>{achievement.target?`${(achievement.targetCompleted/achievement.target*100).toFixed(1)}%`:'—'}</strong><small>{Math.max(0,achievement.target-achievement.targetCompleted).toFixed(2)} tables remaining</small></div><div><span>Target completion date</span><strong>{displayDate(target?.dueDate||period.end)}</strong><small>Each selectable quarter = 0.25 table</small></div></section>
      <table className="revision-block-table"><thead><tr><th>Block</th><th>Traced rows</th><th>Total tables</th><th>Target tables</th><th>Completed tables</th><th>Completion</th></tr></thead><tbody>{[...summary.blocks,summary.total].map(b=><tr key={b.id}><th>{b.id}</th><td>{b.rows}</td><td>{b.tables.toFixed(2)}</td><td>{b.target.toFixed(2)}</td><td>{b.completed.toFixed(2)}</td><td>{b.pct.toFixed(1)}%</td></tr>)}</tbody></table>
      <div className="report-map-pair"><figure><h2>Whole-plant cleaning progress <span>{summary.total.pct.toFixed(1)}%</span></h2><img src={overview.image} alt="Panel-cleaning targets and dated completion across all traced blocks"/><figcaption>{displayDate(p.rangeStart)}–{displayDate(p.rangeEnd)} · all five traced blocks</figcaption></figure><figure><h2>Latest completed area <span>{latestCount.toFixed(2)} tables</span></h2>{latest?<img src={latest.image} alt="Latest panel-cleaning area with nearby dated completion"/>:<div className="report-map-empty">No completed tables in the selected period</div>}<figcaption>Work date: {displayDate(latestDate)} · nearby completion dates are shown</figcaption></figure></div>
      <p className="report-attribution">Green = completed · blue dashed outline = target · labels = work dates. {imageryAttribution}. Archive dates identify releases, not image capture dates.{overview.imageryIncomplete||latest?.imageryIncomplete?' Some satellite tiles were unavailable; geometry is still shown.':''}</p>
      <p className="report-attribution">Block totals match the supplied actual table counts. Full-table reference length: {p.pitch} m; completion increments: 0.25 table. Block 2 contains one empty KML polygon, excluded from totals. Individual subdivision boundaries are derived from traced row lengths; verify their physical alignment.</p>
      {p.details.remarks&&<div className="revision-remarks"><b>Remarks</b><p>{p.details.remarks}</p></div>}
      {!pairs.length&&<Signatures reporting={p.reporting}/>}<footer className="revision-footer"><span>Completion counted once per quarter section within the selected cleaning round and dates.</span><span>Panel-cleaning progress</span></footer>
    </section>
    {!!pairs.length&&<section className="report-sheet photo-sheet"><Header details={p.details} round={round.label}/><h2 className="photo-page-title">Before & after · photographic record</h2>{pairs.map((pair,i)=><section className="report-photo-pair" key={i}><h3>Pair {i+1}{pair.caption?` · ${pair.caption}`:''}</h3><div>{(['before','after'] as const).map(stage=><figure key={stage}><figcaption>{stage}</figcaption>{pair[stage]?<img src={pair[stage]} alt={`${stage} cleaning, pair ${i+1}`}/>:<div className="missing-photo">No {stage} photo supplied</div>}</figure>)}</div></section>)}<Signatures reporting={p.reporting}/><footer className="revision-footer"><span>{p.details.team} · {displayDate(p.details.reportDate)} · {round.label}</span><span>Photographic record</span></footer></section>}
  </article>;
}
