import type { CoverageMetric } from '@/lib/coverage';
import { hectares } from '@/lib/coverage';
import type { ReportDetails } from '@/lib/db';
import type { Reporting, SignRole } from '@/lib/reporting';
import { displayDate, targetWindow } from '@/lib/reporting';
import { imageryAttribution } from '@/lib/report-map';

/* eslint-disable @next/next/no-img-element -- print maps, uploaded photos, and
   signatures are browser-generated data URLs and intentionally bypass image optimization. */

interface Props {
  details:ReportDetails;reporting:Reporting;blocks:CoverageMetric[];overall:CoverageMetric;
  rangeStart:string;rangeEnd:string;latestDate:string;latestHa:number;actualHa:number;
  overview:string|null;latest:string|null;imageryLabel:string;imageryIncomplete:boolean;
}
const pct=(n:number)=>`${n.toFixed(1)}%`;

export function Header({details,round}:{details:ReportDetails;round:string}) {
  return <>
    <div className="report-brand-row"><img src="/ap.png" alt="AboitizPower"/><img src="/cedc.png" alt="China Energy Engineering Group Zhejiang Electric Power Design Institute Co., Ltd."/></div>
    <header className="revision-report-header"><div><h1>{details.title || 'Grass-Cutting Progress Report'}</h1><p>37.8 MWac Armenia Solar Power Project · Barangay Armenia, Tarlac City</p></div><div><strong>{round || 'Quarter / round not specified'}</strong><span>{displayDate(details.reportDate)}</span></div></header>
  </>;
}
export function Signatures({reporting}:{reporting:Reporting}) {
  return <section className="report-signatures">{(['prepared','checked','approved'] as SignRole[]).map(role=>{
    const person=reporting.signatories[role];
    return <div key={role}><span>{role} by</span><div className="signature-space">{person.signature&&<img src={person.signature} alt={`${role} signature`}/>}</div><strong>{person.name || '________________________'}</strong><small>{person.position || '\u00a0'}</small></div>;
  })}</section>;
}
export default function PrintableReport(p:Props) {
  const period=targetWindow(p.reporting.targetPeriod,p.details.reportDate);
  const target=p.reporting.targets[period.key];
  const targetHa=target?.areaHa;
  const hasTarget=targetHa!=null&&targetHa>0;
  const pairs=p.reporting.photos.filter(pair=>pair.before||pair.after);
  const label=p.reporting.targetPeriod[0].toUpperCase()+p.reporting.targetPeriod.slice(1);
  return <article className="print-report">
    <section className="report-sheet summary-sheet">
      <Header details={p.details} round={p.reporting.quarterRound}/>
      <div className="revision-report-meta"><span><b>Contractor:</b> {p.details.team || 'ZEPDI'}</span><span><b>Coverage:</b> {displayDate(p.rangeStart)}–{displayDate(p.rangeEnd)}</span><span><b>Imagery:</b> {p.imageryLabel}</span></div>
      <section className="report-target-strip">
        <div><span>{label} target</span><strong>{hasTarget?`${targetHa.toFixed(3)} ha`:'Not set'}</strong><small>{displayDate(period.start)}–{displayDate(period.end)}</small></div>
        <div><span>Completed in target period</span><strong>{p.actualHa.toFixed(3)} ha</strong><small>Through {displayDate(p.details.reportDate)}</small></div>
        <div><span>Target achievement</span><strong>{hasTarget?pct(p.actualHa/targetHa*100):'—'}</strong><small>{hasTarget?`${Math.max(0,targetHa-p.actualHa).toFixed(3)} ha remaining`:'Enter target area in the app'}</small></div>
        <div><span>Target completion date</span><strong>{displayDate(target?.dueDate || period.end)}</strong><small>All areas are weighted hectares</small></div>
      </section>
      <table className="revision-block-table"><thead><tr><th>Block</th><th>Gross area (ha)</th><th>Panel area (ha)</th><th>Excluded (ha)</th><th>Workable (ha)</th><th>Completed (ha)</th><th>Completion</th></tr></thead><tbody>
        {[...p.blocks,{...p.overall,id:'TOTAL'}].map(b=><tr key={b.id}><th>{b.id}</th><td>{hectares(b.grossSqm)}</td><td>{hectares(b.panelSqm)}</td><td>{hectares(b.excludedSqm)}</td><td>{hectares(b.workableSqm)}</td><td>{hectares(b.completedSqm)}</td><td><strong>{pct(b.completionPct)}</strong></td></tr>)}
      </tbody></table>
      <div className="report-map-pair">
        <figure><h2>Whole-plant progress <span>{pct(p.overall.completionPct)}</span></h2>{p.overview?<img src={p.overview} alt="Whole plant and selected-period grass-cutting progress"/>:<div className="report-map-empty">Map unavailable</div>}<figcaption>Coverage: {displayDate(p.rangeStart)}–{displayDate(p.rangeEnd)} · framing from supplied whole-plant boundary</figcaption></figure>
        <figure><h2>Latest completed area <span>{hectares(p.latestHa*10000)} ha</span></h2>{p.latest?<img src={p.latest} alt="Close-up of latest grass-cutting completion"/>:<div className="report-map-empty">No grass-cutting coverage in the selected period</div>}<figcaption>Work date: {displayDate(p.latestDate)} · close-up of the most recent dated coverage</figcaption></figure>
      </div>
      <div className="report-map-notes"><span className="report-date-key"><i/> {displayDate(p.rangeStart)} → {displayDate(p.rangeEnd)} · older to newer</span><span>Dates = completed work · orange dashed outline = target · red = exclusion · gold = panels.</span></div>
      <p className="report-attribution">{imageryAttribution}. Archive date denotes release, not capture date.{p.imageryIncomplete?' Some satellite tiles were unavailable; coverage geometry is still shown.':''}</p>
      {p.details.remarks&&<div className="revision-remarks"><b>Remarks</b><p>{p.details.remarks}</p></div>}
      {pairs.length===0&&<Signatures reporting={p.reporting}/>} 
      <footer className="revision-footer"><span>Ordinary area: 100% · panel area: 28.6% · exclusions: 0% · overlapping coverage counted once.</span><span>Progress summary</span></footer>
    </section>
    {pairs.length>0&&<section className="report-sheet photo-sheet"><Header details={p.details} round={p.reporting.quarterRound}/><h2 className="photo-page-title">Before & after · photographic record</h2>
      {pairs.map((pair,i)=><section className="report-photo-pair" key={i}><h3>Pair {i+1}{pair.caption?` · ${pair.caption}`:''}</h3><div>{(['before','after'] as const).map(stage=><figure key={stage}><figcaption>{stage}</figcaption>{pair[stage]?<img src={pair[stage]} alt={`${stage} grass-cutting, pair ${i+1}`}/>:<div className="missing-photo">No {stage} photo supplied</div>}</figure>)}</div></section>)}
      <Signatures reporting={p.reporting}/>
      <footer className="revision-footer"><span>{p.details.team || 'ZEPDI'} · {displayDate(p.details.reportDate)} · {p.reporting.quarterRound}</span><span>Photographic record</span></footer>
    </section>}
  </article>;
}
