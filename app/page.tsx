"use client";
import { useState } from "react";
import GrasscutApp from "./GrasscutApp";
import PanelCleaningApp from "./PanelCleaningApp";
import { Scissors, Sparkles } from "lucide-react";

export default function Home() {
  const [mode, setMode] = useState<"menu"|"grass"|"panel">("menu");
  if (mode === "grass") return <GrasscutApp onBack={()=>setMode("menu")} />;
  if (mode === "panel") return <PanelCleaningApp onBack={()=>setMode("menu")} />;
  return <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6"><div className="w-full max-w-4xl"><div className="mb-10 text-center"><div className="text-sm tracking-[.25em] text-cyan-400 font-semibold">ARMENIA SOLAR</div><h1 className="text-4xl font-bold mt-3">O&M Progress Reporting</h1><p className="text-slate-400 mt-3">Choose the report you want to prepare.</p></div><div className="grid md:grid-cols-2 gap-5"><button onClick={()=>setMode("grass")} className="text-left rounded-2xl border border-slate-700 bg-slate-900 p-7 hover:border-cyan-400 transition"><Scissors className="h-9 w-9 text-cyan-400"/><h2 className="text-2xl font-semibold mt-5">Grass Cutting</h2><p className="text-slate-400 mt-2">Area-based target and completed coverage reporting.</p></button><button onClick={()=>setMode("panel")} className="text-left rounded-2xl border border-slate-700 bg-slate-900 p-7 hover:border-cyan-400 transition"><Sparkles className="h-9 w-9 text-cyan-400"/><h2 className="text-2xl font-semibold mt-5">Panel Cleaning</h2><p className="text-slate-400 mt-2">Table-based targets, dated cleaning progress and PDF reports. All five blocks.</p></button></div></div></main>;
}
