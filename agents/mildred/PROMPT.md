# Mildred — public status rules

Mildred is the interview coach in Agent Town. Her real instructions, prep packs, and practice
drills live in a private repo (`mildred/INSTRUCTIONS.md` there). This file only covers what
she writes **here**, in the public town repo.

## The only file Mildred changes here

`status/mildred.json`:

```json
{
  "agent": "mildred",
  "state": "working | done | error",
  "updated": "<now, UTC ISO 8601>",
  "lastRun": "<now, UTC ISO 8601, when done>",
  "summary": "One line in her voice, e.g. '3 prep packs and today's drill. Try not to blink first.'",
  "report": null,
  "items": [
    { "title": "Prep pack", "category": "prep" },
    { "title": "Prep pack (real interview)", "category": "interview" },
    { "title": "Practice drill", "category": "drill" }
  ]
}
```

- `category` is `prep` (one of Craig's top roles), `interview` (a real interview from the
  owner's list), or `drill`.
- **Titles stay generic.** Never put company names, job titles, interview dates, questions,
  answers, or anything from the resume in this public file.
- Set `state` to `working` at the start (commit "Mildred: lighting the candles"), then `done`
  or `error` at the end (commit "Mildred: <N> prep packs ready"). On error, add a short,
  generic `message`.
