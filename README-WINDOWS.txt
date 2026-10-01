ARMENIA O&M REPORTING — WINDOWS / MAC READY v0.6.2

Requirements: Node.js 22.13 or newer, a current browser, and internet for imagery.

1. Export history from your old grass-cutting app before updating.
2. Extract the ZIP completely; do not run directly from inside the archive.
3. Windows: double-click START_APP.bat.
   Mac: double-click START_APP.command, or open Terminal in this folder and run
   node windows-server.mjs
4. Keep the launcher open. Open http://127.0.0.1:4173 if the browser does not open.
5. Choose Grass Cutting or Panel Cleaning on the startup screen.
6. Hover over or focus either map, then hold W/A/S/D to pan.
7. Use the Reports button in either editor's header to return to the menu.
   Grass-cutting pending changes are saved before the editor closes.

The compiled app is included. Do not run npm install or build to use it.
If a Mac launcher permission error occurs, run:
chmod +x START_APP.command

Backups are local to the browser and address. Import the prior exported history
if you changed browser or previously used localhost:5173. Each reporting module
has its own backup format and separate saved history. Panel totals now match 2,873 actual tables at 16.335 m/table.
Previous panel progress is preserved separately; use Export previous panel
backup to download it. Old panel backups require the matching old package.
See PANEL-CLEANING.txt.

PDF: select Export PDF, Save as PDF, A4 landscape. Enable background graphics;
disable browser headers and footers. Inspect the PDF before submitting.
