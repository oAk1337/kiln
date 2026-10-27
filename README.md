# Kiln

Kiln is a personal workout tracker. It is a mobile-first Progressive Web App for one person logging lifts, mostly on an Android phone in Chrome and sometimes on a desktop browser.

The repo is public and the app ships empty. There is no account, no server, and no sample plan. Programs, weights, and history stay in IndexedDB on the device (localStorage only if IndexedDB cannot open). Move data between devices by exporting a JSON file.

Expected site: [https://oak1337.github.io/kiln/](https://oak1337.github.io/kiln/)

## Install

Open the site in Chrome. Use **Add to Home screen** or **Install app**. After the first load, Kiln works offline. The rest timer vibrates and beeps when it finishes. A logged set starts the timer, which defaults to 90 seconds and can be changed from the timer chip or from Settings.

## What you can do

- **Program.** Build a repeating cycle of days. Each day has exercises in order, with target sets, a rep range, an optional note, an optional superset letter, an optional machine or sled base weight, and a bodyweight flag. A day with no exercises is a rest day. Each day can have a cardio note.
- **Today.** Shows the next day after the last one you logged, or a day you pick. Each exercise shows the previous session and a suggested set. Logging uses a weight stepper, a rep stepper, a warm-up or working toggle, and an optional note. The suggestion is filled in, so a matching set is one tap.
- **Double progression.** If every set at the heaviest working weight hit the top of the rep range, Kiln suggests adding the weight increment (5 lb by default) and starting again at the bottom of the range. Otherwise it suggests the same weight and one more rep. Lighter back-off sets do not block the increase. Bodyweight work progresses by reps.
- **Base weight.** An exercise can store a sled, machine, or bar weight in pounds. You log the total load. Kiln shows plates per side, and chips add a pair.
- **History.** Sessions by date, and a per-exercise chart of top-set load and estimated 1RM (Epley), drawn with inline SVG. Bodyweight exercises chart top-set reps because the load is 0.
- **Backup.** Download JSON, share it when the browser supports the Web Share API, and import it with merge or replace. Merge skips set ids that already exist. You can also import a CSV of logged sets.

## Develop

```bash
npm install
npm test
npm run dev
npm run build
npm run verify
```

`npm run dev` is the local app. `npm run build` writes static files to `dist/` and generates a cache-first service worker whose cache name changes when the build changes. `npm run verify` rebuilds, serves the site at `/kiln/`, and checks the manifest, offline reload, logging, and JSON round-trip in headless Chrome. `npm run icons` redraws the PNG icons.

The production paths are relative, so the same build works under the `/kiln/` GitHub Pages subpath.

## JSON backup

`schemaVersion` is `1`. Loads are pounds (`loadLb`, `baseWeightLb`). `settings.weightIncrement` is in `settings.unit`. Merge matches days, exercises, sessions, and sets by `id`, and the set `id` is the dedupe key. Full tables, merge rules, and the CSV columns are in [docs/schema.md](docs/schema.md).

Exact fields:

- Root: `schemaVersion`, `app`, `exportedAt`, `settings`, `days`, `sessions`
- `settings`: `unit`, `weightIncrement`, `defaultRestSeconds`
- `days[]`: `id`, `name`, `cardioNote`, `exercises`
- `exercises[]`: `id`, `name`, `targetSets`, `repMin`, `repMax`, `note`, `superset`, `baseWeightLb`, `bodyweight`
- `sessions[]`: `id`, `date`, `dayId`, `dayName`, `createdAt`, `entries`
- `entries[]`: `id`, `exerciseId`, `exerciseName`, `setType`, `reps`, `loadLb`, `bodyweight`, `note`, `loggedAt`

`setType` is `warmup` or `working`. `bodyweight` true stores `loadLb` 0. `baseWeightLb` null means there is no sled or bar base. `superset` is a short label; the same letter marks a superset, and each exercise is logged separately.

Fake example, not a real plan:

```json
{
  "schemaVersion": 1,
  "app": "kiln",
  "exportedAt": "2026-01-15T12:00:00.000Z",
  "settings": {
    "unit": "lb",
    "weightIncrement": 5,
    "defaultRestSeconds": 90
  },
  "days": [
    {
      "id": "day_example_a",
      "name": "Day A",
      "cardioNote": "Easy 10 minutes",
      "exercises": [
        {
          "id": "ex_example_press",
          "name": "Example Press",
          "targetSets": 3,
          "repMin": 6,
          "repMax": 10,
          "note": "Pause at the bottom",
          "superset": "A",
          "baseWeightLb": null,
          "bodyweight": false
        },
        {
          "id": "ex_example_row",
          "name": "Example Row",
          "targetSets": 3,
          "repMin": 8,
          "repMax": 12,
          "note": "",
          "superset": "A",
          "baseWeightLb": 120,
          "bodyweight": false
        },
        {
          "id": "ex_example_raise",
          "name": "Example Raise",
          "targetSets": 2,
          "repMin": 10,
          "repMax": 15,
          "note": "",
          "superset": "",
          "baseWeightLb": null,
          "bodyweight": true
        }
      ]
    },
    {
      "id": "day_example_rest",
      "name": "Rest",
      "cardioNote": "Walk",
      "exercises": []
    }
  ],
  "sessions": [
    {
      "id": "ses_example_1",
      "date": "2026-01-14",
      "dayId": "day_example_a",
      "dayName": "Day A",
      "createdAt": "2026-01-14T15:00:00.000Z",
      "entries": [
        {
          "id": "ent_example_1",
          "exerciseId": "ex_example_press",
          "exerciseName": "Example Press",
          "setType": "warmup",
          "reps": 10,
          "loadLb": 45,
          "bodyweight": false,
          "note": "",
          "loggedAt": "2026-01-14T15:01:00.000Z"
        },
        {
          "id": "ent_example_2",
          "exerciseId": "ex_example_press",
          "exerciseName": "Example Press",
          "setType": "working",
          "reps": 10,
          "loadLb": 100,
          "bodyweight": false,
          "note": "smooth",
          "loggedAt": "2026-01-14T15:05:00.000Z"
        },
        {
          "id": "ent_example_3",
          "exerciseId": "ex_example_press",
          "exerciseName": "Example Press",
          "setType": "working",
          "reps": 10,
          "loadLb": 100,
          "bodyweight": false,
          "note": "",
          "loggedAt": "2026-01-14T15:08:00.000Z"
        },
        {
          "id": "ent_example_4",
          "exerciseId": "ex_example_press",
          "exerciseName": "Example Press",
          "setType": "working",
          "reps": 10,
          "loadLb": 100,
          "bodyweight": false,
          "note": "",
          "loggedAt": "2026-01-14T15:11:00.000Z"
        }
      ]
    }
  ]
}
```

## CSV import

Header, exactly:

`date,day,exercise,set_type,sets,reps,load_lb,notes`

Each row is one or more identical sets. `sets` is the count. `reps` may be blank. `load_lb` is a number of pounds or `bodyweight`. Notes are copied to every set from that row. Import adds those sets and dedupes if the same file is imported again.

## Publish

GitHub Actions deploys `dist/` to Pages on every push to `main` (`.github/workflows/pages.yml`) using `actions/configure-pages`, `actions/upload-pages-artifact`, and `actions/deploy-pages`.

The repository owner has to set Pages to GitHub Actions once: **Settings → Pages → Build and deployment → Source: GitHub Actions**. If this repo's token cannot change that setting, the workflow file is still on `main` and the deploy runs after the source is switched.
