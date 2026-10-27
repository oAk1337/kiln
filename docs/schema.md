# Kiln backup schema

Version 1. Kiln stores every load in pounds. The settings unit only changes how numbers are shown and how the weight increment is entered. A backup is a single JSON object. The app ships with no program and no history; this file is how a real plan moves onto a device.

Field order below matches an export. Import accepts the same fields. Missing optional fields use the defaults in the table. Unknown fields are ignored. `schemaVersion` must be `1`.

## Root

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `schemaVersion` | number | yes | Always `1`. |
| `app` | string | no | Always `"kiln"` on export. |
| `exportedAt` | string | no | ISO-8601 timestamp. |
| `settings` | object | yes | Display preferences. |
| `days` | array | yes | Program cycle, in order. |
| `sessions` | array | yes | Logged days. |

## `settings`

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `unit` | `"lb"` or `"kg"` | yes | Display unit. Default `lb`. |
| `weightIncrement` | number | yes | Stepper and double-progression jump, measured in `unit`. Default `5` when `unit` is `lb`. |
| `defaultRestSeconds` | number | yes | Rest timer used after a logged set. Default `90`. Clamped to 15–600. |

## `days[]`

Array order is the training cycle. The day after the last logged day is what Today opens, wrapping around.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | string | yes | Stable id. Merge matches on this. |
| `name` | string | yes | Day name, such as a placeholder like "Day A". |
| `cardioNote` | string | no | Optional note shown on that day. Default `""`. |
| `exercises` | array | yes | Exercises in the order they are trained. |

### `exercises[]`

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | string | yes | Stable id. |
| `name` | string | yes | Exercise name. |
| `targetSets` | integer | yes | Working sets to aim for, 1–20. |
| `repMin` | integer | yes | Bottom of the rep range. |
| `repMax` | integer | yes | Top of the rep range. Raised to `repMin` if it is lower. |
| `note` | string | no | Coaching note. Default `""`. |
| `superset` | string | no | Superset label. Empty means not in a superset. The same letter groups a superset. Each exercise is still logged on its own. |
| `baseWeightLb` | number or null | no | Machine, sled, or bar base in pounds. `null` if unused. Logged load is the total. Plates per side are `(total − base) / 2`. |
| `bodyweight` | boolean | no | When true, load is bodyweight and stored as `0`. Default `false`. |

## `sessions[]`

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | string | yes | Stable id. |
| `date` | string | yes | Local calendar date, `YYYY-MM-DD`. |
| `dayId` | string or null | no | Program day id, or `null` if the day was not in the program. |
| `dayName` | string | no | Day name copied onto the session. |
| `createdAt` | string or null | no | ISO-8601 timestamp. |
| `entries` | array | yes | Sets in log order. |

### `entries[]`

Merge dedupes on `id`. An existing id is left as-is.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | string | yes | Stable id. This is the merge key. |
| `exerciseId` | string or null | no | Program exercise id, if it matched. |
| `exerciseName` | string | yes | Name copied onto the set. |
| `setType` | `"warmup"` or `"working"` | yes | Warm-up sets do not drive the suggestion. |
| `reps` | integer or null | no | Reps. `null` is allowed, including for a warm-up with a blank CSV rep count. |
| `loadLb` | number | yes | Total load in pounds. `0` when `bodyweight` is true. |
| `bodyweight` | boolean | yes on export | Bodyweight set. Load is `0`. |
| `note` | string | no | Optional set note. |
| `loggedAt` | string or null | no | ISO-8601 timestamp. |

## Merge and replace

- **Merge** keeps settings already on the device. Days with the same `id` take the imported name, cardio note, and exercises; exercises with the same `id` are replaced, and exercises that exist only on the device stay. Sessions with the same `id` gain entries whose `id` is not already present. New days and sessions are added. Nothing local is deleted.
- **Replace** overwrites settings, days, and sessions with the file.

## Suggestions

For the heaviest working weight in the previous session (lighter back-off sets are ignored):

- If every set at that weight reached `repMax`, Today suggests that weight plus `weightIncrement`, for `repMin` reps.
- Otherwise it suggests the same weight and one more rep than the lowest set at that weight, capped at `repMax`.
- Bodyweight exercises never add load. Hitting `repMax` keeps the top of the range; otherwise Today suggests one more rep.
- Estimated 1RM on the history chart uses Epley: `loadLb × (1 + reps / 30)`. A 1-rep set uses the load itself. Bodyweight charts top-set reps because load is 0.

## Example

This file is fake. It is not a training plan.

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

On the day after that session, with only "Day A" in the cycle, Today suggests **105 lb × 6** for Example Press. Example Row shows a plates helper from its 120 lb base. Example Raise is bodyweight.

## CSV

History can also be imported from a CSV. The header must be exactly these columns, in any order:

`date,day,exercise,set_type,sets,reps,load_lb,notes`

| Column | Meaning |
| --- | --- |
| `date` | `YYYY-MM-DD`. |
| `day` | Day name. Matched to the program when the name is the same, ignoring case. |
| `exercise` | Exercise name. Matched within that day when the name is the same. |
| `set_type` | `working` or `warmup` (`warm-up`, `warm_up`, and `wu` are also accepted). |
| `sets` | How many identical sets this row creates. Whole number from 1 to 50. |
| `reps` | Whole number, or blank. |
| `load_lb` | Pounds, even if the app is showing kilograms. A number, blank (`0`), or `bodyweight` (`bw` is also accepted). |
| `notes` | Optional. Copied onto each set from the row. Quotes follow normal CSV rules. |

Rows with the same date and day become one session. Importing the same file again does not duplicate sets. CSV import only adds log entries. It does not replace the program or settings.

```csv
date,day,exercise,set_type,sets,reps,load_lb,notes
2026-02-01,Day A,Example Press,working,3,8,100,
2026-02-01,Day A,Example Press,warmup,2,,45,easy
2026-02-01,Day A,Example Raise,working,2,12,bodyweight,fake note
```
