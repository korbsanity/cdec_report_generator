import Dexie, { type EntityTable } from "dexie";
import type { Reporting } from "./reporting";
import type { AreaFeature } from "./coverage";

export interface ReportDetails {
  title: string;
  reportDate: string;
  preparedBy: string;
  team: string;
  remarks: string;
}

export interface CoverageDay {
  date: string;
  geometry: AreaFeature;
  updatedAt: string;
}

export interface SavedProject {
  id: "current";
  version: 2 | 3;
  reporting?: Reporting;
  updatedAt: string;
  brushMeters: number;
  coverageDays: CoverageDay[];
  workDate: string;
  rangeStart: string;
  rangeEnd: string;
  imageryId: string;
  details: ReportDetails;
}

export interface LegacyProject {
  id: "current";
  version: 1;
  updatedAt: string;
  brushMeters: number;
  coverage: AreaFeature | null;
  details: ReportDetails;
}

export const projectDb = new Dexie("grasscut-report") as Dexie & {
  projects: EntityTable<SavedProject | LegacyProject, "id">;
};

projectDb.version(1).stores({
  projects: "id, updatedAt",
});

projectDb.version(2).stores({
  projects: "id, updatedAt",
});
