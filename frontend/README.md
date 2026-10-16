# HydroTwin AI: frontend

This folder goes **next to** your `backend` folder. Nothing in `backend` was changed.

```
HydroTwin/
  backend/      <- your existing backend (unchanged)
  frontend/     <- this folder
```

## 1. One-time setup

1. Install Node.js (version 18 or newer) from https://nodejs.org (choose "LTS").
2. In VS Code, open the `HydroTwin/frontend` folder, then open a terminal (Terminal > New Terminal).
3. Run:

```
npm install
```

## 2. Every time you want to run the app

You need **two terminals**.

**Terminal 1: backend** (open it in the `HydroTwin` folder, not inside `backend`):

```
uvicorn backend.main:app --reload --port 8000
```

**Terminal 2: frontend** (inside `HydroTwin/frontend`):

```
npm run dev
```

Then open **http://127.0.0.1:3000** in Chrome or Edge.

The frontend must stay on port 3000 because your backend only accepts requests from
`localhost:3000` / `127.0.0.1:3000`. If your backend is not on port 8000, copy `.env.example`
to `.env` and change the address.

## 3. What the app does

1. **Choose location.** Search or click the map. Only Punjab, Pakistan is accepted. After you press
   *Lock location*, the map is dimmed and blurred, and the location can't be changed (use *Start over*).
2. **Explore the 3D twin.** 2 km x 2 km around your site: real terrain (`/terrain-3d`), buildings, roads,
   rivers and canals (`/osm-3d`), with satellite imagery draped on top. Orbit 360, zoom, street level, VR button.
3. **Mark your property.** Pick *I have a house* or *Empty plot*, then **draw** the corners on the 3D
   ground or **write** the from/to latitude and longitude.
4. **Flood risk.** Your backend extracts the 9 features (`/assess-location`), and the saved Random Forest
   runs three rainfall scenarios (`/predict`): next week, next month, next year. The 3D view shows rain and
   rising water, and tells you whether the house stays dry or floods.
5. **Recommendations.** For a house: how much to raise the floor. For an empty plot: *do not build* (High risk),
   *build only with a raised design* (Moderate), or *suitable* (Low), plus the minimum floor height.
   Also a perimeter drain with an outlet to the nearest mapped waterway.
6. **Updated design.** Switch between *current* and *with changes* in 3D (raised floor on a plinth, drain in cyan).
7. **Report.** Before/after pictures, results, features, limits. Print or save as PDF, or download as HTML.

## 4. How the numbers are made (be ready to explain this in your viva)

* **Flood probability** comes only from your trained Random Forest.
* **Week / month / year** are *rainfall scenarios*, not weather forecasts. The week scenario uses the live
  7-day forecast from Open-Meteo when the internet works. Month and year use 70% and 100% of the 2022
  monsoon rainfall in your dataset. You can change these in *Rainfall assumptions* (step 4).
* **Water depth in 3D** is an estimate: 0 m at 30% probability, up to 2 m at 100%. It is **not** a hydraulic simulation.
* **Recommended floor height** = highest drawn water depth + 0.5 m freeboard.
  Why not ask the model? When tested, your model's output changes very little if you only raise `hand_m`
  or `elevation_m` by a few metres (it is driven mostly by rainfall). So the model decides *how risky the site is*,
  and a standard safety margin decides *how high to build*.
* All assumptions are in `src/config.js`.

## Where you cannot build (new)

When you mark a property, the app checks it against the mapped roads, rivers, canals and drains,
and (for an empty plot) existing buildings. Overlapping any of them is **blocked**. Being close to a
road edge or inside a waterway setback gives a **warning**. The margins are in `src/limits.js`
(`SITE_LIMITS`). They are starting values, not legal rules: replace them with your local
authority's by-laws.

## The model house, the picture and the voice (new)

* **Model house.** When you add a plot (or a house that has no building mapped on it), the app builds
  its own house in Three.js: plinth and steps, walls, parapet roof with a water tank, door, windows, and a
  boundary wall. It is sized and turned to fit the plot. Change it in `src/house.js`. In *Updated design* the
  plinth rises to the recommended floor height. Mapped OpenStreetMap buildings keep their real outline.
* **Flood picture.** A side view of the house with the floor line and the water level, for the chosen time
  frame (`src/illustration.js`). It appears in Flood risk, Updated design and the report.
* **Voice.** *Read aloud* speaks the result in English (browser text-to-speech, nothing is uploaded).
  It reads automatically after each result unless you untick the box.
* **Searching.** Full house addresses are rarely in OpenStreetMap for Pakistan, so the search tries shorter
  versions (street, block, area, city) and tells you when it fell back. You can also paste coordinates
  (`31.52, 74.36`) or a Google Maps link and it picks that point directly (must be inside Punjab).
* **VR button.** Real VR needs a headset (for example Meta Quest, by Quest Link or its own browser), a
  WebXR browser and a secure page (https or localhost). A normal screen cannot enter VR, so the button reads
  "VR: why not available?" and explains which of these is missing. 360-degree orbit and zoom work everywhere.
* **Picture tools** (Property step). *Floor height from a photo*: click road level, floor level, then the top
  and bottom of a door (2.1 m) or another known height. *Plot from a picture*: click the plot corners, then
  one edge and its real length, then the up direction and the location. The tool asks for anything missing.
  Floor height is limited to -0.8 to 3 m. Results are estimates from a photo, so check them on site.

## 5. If something goes wrong

| Message / problem | Fix |
| --- | --- |
| Red banner: backend is not running | Start Terminal 1 and reload the page |
| "Could not build the twin" | The backend answered with an error. Read the message. Most often a data file path on `D:\dataset` is wrong |
| Analysis takes long | `/assess-location` reads big GIS files. Up to a minute is normal |
| Ground is green/tan, not satellite | No internet or the imagery server was blocked. Everything else still works |
| Search finds nothing | Nominatim needs internet. Click the map instead |
| Port 3000 already in use | Close the other program. Vite is set to refuse another port, on purpose |

## 6. Files

```
src/config.js     settings and assumptions
src/api.js        calls to your backend
src/geo.js        Punjab check, search, coordinate maths
src/map.js        step 1 map (Leaflet)
src/twin.js       3D scene (Three.js)
src/analysis.js   scenarios, depth, recommendations
src/limits.js     where a house may NOT stand (roads, waterways, buildings)
src/house.js      the model house and boundary wall built in Three.js
src/illustration.js  the side-view flood picture (SVG)
src/imageTool.js  measure floor height / plot from a picture
src/narration.js  the sentences the voice reads (English)
src/voice.js      browser text-to-speech
src/report.js     report page
src/main.js       the step-by-step flow
src/styles.css    look and feel
```
