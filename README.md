# Armenia O&M Reporting — v0.6.2

A free, locally run browser app for mapping grass-cutting work at the **37.8 MWac
Armenia Solar Power Project**, Barangay Armenia, Tarlac City. It uses Esri
satellite imagery, calculates area-weighted completion for Blocks B1–B5, keeps
dated work history, and prints an AboitizPower-branded PDF report.

## Panel cleaning — v0.6.2

The startup screen offers **Grass Cutting** and **Panel Cleaning**. Grass cutting
retains its existing area-based workflow. Panel cleaning uses all five supplied
blocks, with table geometry aligned to each traced row.

- Whole-table, half-table, and quarter-table selection by click, rectangle, or polygon.
- Each quarter counts as 0.25 table; totals are weighted table equivalents.
- Geometry-based targets for daily, weekly, monthly, and quarterly periods.
- Work dates, date-range filtering, history, separate cleaning rounds, and Undo.
- Local autosave and separate panel-cleaning JSON backup/import.
- Esri current imagery and Wayback releases, whole-plant and latest-area PDF maps.
- Before/after photos, report details, and final prepared/checked/approved sign-offs.

The geometry reproduces the supplied **2,873 actual tables across 499 usable
row polygons**: B1 684, B2 684, B3 684, B4 502.

The corrected full-table reference length is **16.335 m**. The former 32.67 m
unit represents two actual tables. A half table is about 8.1675 m and a quarter
about 4.08375 m.

Saved panel projects are isolated by dataset identity, including calibration.
Old panel progress remains in its previous database and can be downloaded using
**Export previous panel backup**. It is not automatically assigned to the new,
smaller polygons. Old panel backups require their matching app package; current
backups can be imported normally. Grass-cutting history uses its existing store.

Panel sources and the count/calibration manifest are bundled in
`source-data/panel-cleaning`. Regenerate them with
`python3 scripts/prepare_panel_data.py` followed by `npm run prepare:panel`. Generation
fails if any computed block total differs from the actual count.

### Map navigation and imagery — v0.6.2

Both editors support **WASD** panning: W up, A left, S down, D right.
Hover over the map or focus it, then hold the keys. Diagonal movement works;
shortcuts do not intercept typing, menu controls, or modifier-key combinations.
Grass cutting now has a **Reports** button in the header and on loading/error
screens. It saves pending work before returning to the menu.

The shared imagery loader limits native requests to zoom 18 while allowing the
map to zoom closer by enlarging available pixels. Missing tiles fall back to
properly cropped parent tiles from the same selected imagery release. The
loader asks Esri to return an error for missing tiles instead of a gray placeholder.
Both editors and PDF maps use the same loader. Zooming closer improves polygon
selection but does not create extra satellite detail. Imagery remains dependent
on the selected release, provider coverage, and internet access.

### Quick start for the compiled package

Extract the ZIP first. On Windows, run `START_APP.bat`. On macOS, run
`START_APP.command` (or `node windows-server.mjs` from this folder in Terminal).
Node.js 22.13 or newer is required; npm installation is unnecessary for this
compiled package. The app opens at **http://127.0.0.1:4173**. Keep the launcher open.

Before updating, export existing grass-cutting history. Browser storage depends
on the browser and URL; if you previously used localhost:5173, import the backup
at the new address. Panel cleaning uses its own database and backup format.

For instructions, see `PANEL-CLEANING.txt` and `README-WINDOWS.txt`.

## Existing grass-cutting features — v0.4.0

- Spatial target areas drawn with the same Paint, Rectangle, Polygon, Erase,
  Undo, and Redo tools used for completed work
- Automatic weighted-hectare calculation from each drawn daily, weekly,
  monthly, or quarterly target
- Orange dashed target overlay in the editor and both PDF maps
- Target achievement limited to completed work inside the drawn target
- Ten-percent tighter whole-plant PDF map with work-date labels
- Latest-area PDF map includes nearby dated work and more reliable Esri imagery
- Compact block table and sign-offs moved to the final report section

## Version 0.3.0 additions

- AboitizPower and CEDC report branding using the supplied logos
- Figtree and Calibri report typography
- Quarter/round, contractor, target-period, target-area, and target-date fields
- Daily, weekly, monthly, or quarterly weighted-hectare target tracking
- Whole-plant and latest-completion map views in the PDF report
- MM/DD/YYYY work-date labels and hover dates on completed areas
- Two before/after photo pairs
- Prepared by, Checked by, and Approved by fields with signature uploads
- Complete portable history backup, including report fields and uploaded images

## Calculation rules

- Ordinary plant areas count at **100%**.
- Panel-bounded areas count at **28.6%**.
- Permanent exclusions count at **0%**, even when painted.
- Overlapping work is merged and never counted twice in the selected period.
- Plant-wide completion is area-weighted, not the average of block percentages.
- KML sections such as `B1-E`, `B1-N`, and `B1-W` are combined as **B1**.

The app embeds the revised `PLANT AREA.zip`. `B1-PANELS.kml` is interpreted as
B3 panels as confirmed, and the old Block 5 panel shape is replaced by the
revised `B5-E-PANELS.kml` and `B5-W-PANELS.kml` files from `BLOCK 5.zip`.

Current calculated totals are approximately 32.183 ha gross, 26.666 ha panel,
0.465 ha excluded, and 12.678 weighted workable hectares.

## Requirements

- Node.js 22 or newer
- Current Chrome, Edge, Firefox, or Safari
- Internet access for Esri World Imagery and Wayback tiles

No API key, account, or payment method is built into this app. Esri imagery is
still subject to Esri service terms and attribution requirements.

## Start locally

### Windows client — no terminal commands

1. Install the **LTS** version of Node.js from <https://nodejs.org/en/download>.
2. Restart Windows after installation.
3. Right-click the application ZIP and select **Extract All**.
4. Open the extracted `grasscut-report` folder.
5. Double-click `START_APP.bat`.

The app opens in the default browser. Keep the black launcher window open while
using the app and close it when finished. The Windows package already contains
the built application; `npm install` is not required.

### Development or macOS

Open Terminal in the extracted project folder. If the folder is in Downloads:

```bash
cd ~/Downloads/grasscut-report
npm install
npm run dev
```

Open the local address displayed in the terminal, normally
`http://localhost:5173`.

## Basic workflow

1. Select **Completed work**, then set the **Work date** before drawing. Each date becomes a separate history record.
2. Use **Paint**, **Rectangle**, or **Polygon** to add completed work. For Polygon,
   click each corner and double-click the final corner. **Erase** changes only the
   active work date.
3. Select **Target area** to draw the selected report period's target with those
   same tools. The app calculates its weighted hectares automatically.
4. Set **View from** and **View to** to calculate and display a historical period.
   Older records are light cyan and newer records are dark indigo.
5. Choose current Esri World Imagery or an archived Wayback release. A Wayback
   date is the archive publication date and may not be the satellite capture date.
6. Complete the report details and select **Export PDF**, then choose **Save as PDF**.
   The report includes whole-plant and latest-work maps, target performance,
   two optional before/after photo pairs, and the three sign-off roles.
7. Use **Export history** to create a portable JSON backup. On another computer,
   open the app and use **Import history** to restore all dated shapes, selected
   dates, imagery choice, brush size, report details, targets, images, and signatures.

Work is also saved automatically in the browser. Browser storage is specific
to the browser profile and may be erased when browsing data is cleared, so keep
JSON backups for important reports. Version 1 backups from the original app are
migrated to a dated history record.

## Rebuild data and verify

The original KML ZIP files are retained in `source-data`. After replacing a ZIP,
regenerate the browser data with:

```bash
python3 scripts/prepare_site_data.py
python3 scripts/prepare_wayback_catalog.py
npm run test
```

`prepare_wayback_catalog.py` downloads Esri's official archive catalog, so that
step requires internet access. Original KML ZIPs are retained in `source-data`.
