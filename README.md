# Agent Town

A cozy little tech city where my AI agents live. Each agent gets a townhouse with a
holo-kiosk out front. When it's working, the resident walks between their door and the
kiosk. When it's done, the results show up on the kiosk and they hang out in their yard.
At night they go to sleep.

**Live town:** https://blkctrs-sys.github.io/agent-town/

Add `?hour=21` to preview a time of day, `?event=halloween` or `?event=none` to preview the seasonal theme, and `?witch=1` to summon the witch right away.

## How it works

- Agents run as scheduled Claude Code routines in the cloud.
- After each run, an agent commits its results to this repo and updates its status file.
- The town (`index.html`, `town.js`, `style.css`) reads those files and animates them.

```
agents.json             list of residents: name, colour, which plot they live on
status/<agent>.json     each agent's latest status (read by the town)
agents/<agent>/PROMPT.md  the agent's instructions
jobs/                   Job Scout's daily reports and seen-jobs list
reports/                the Reading Room: every Craig report plus Donathan's prep, in one page
studio/                 Brenden's Studio: his content desks and video packages, ready to copy
```

## Reading Room

`reports/` (linked from the town header) collects all of Craig's reports into one
filterable job board, with a per-day chart and each full report. Donathan's prep packs and
drills, the interview list, and Craig's tailored resumes live in the private repo, so the
page only shows them after you paste a fine-grained GitHub token with **Contents:
Read-only** access to `agent-town-private`. The token stays in that browser; the page has
instructions for making one.

## Brenden's Studio

`studio/` (linked from the town header, the Reading Room, and Brenden's kiosk) shows Brenden's
drafts from the private repo as clean cards: the latest Sunday content desk with a copy
button on every post, Shorts idea and newsletter, every video package, past desks, the inbox,
and the content schedule. Anything Brenden marked `[[ADD: …]]` is highlighted and listed under
"Brenden needs from you". It uses the same token as the Reading Room, so unlocking one unlocks both.

## Residents

- **Craig**, Job Scout: finds new openings every weekday morning.
- **Brenden**, Content Producer: drafts posts and video packages.
- **Penny**, Inbox Keeper: cleans Gmail every morning and flags what matters. Reports stay in the private repo.
- **Donathan**, Interview Coach (files under `mildred/`): preps for Craig's top 3 roles and any interviews on the
  owner's list, plus a daily practice drill. Everything he writes stays in the private repo.

Resident looks in `agents.json`: `color`, `skin`, `hat` or `hair`, `hairStyle` (`"emo"`),
`hairStreak`, `prop` (`"boombox"`, `"pumpkin"` or `"guitar"`), and `ride` (`"skateboard"`, deck color in `board`).

## Status file format

```json
{
  "agent": "job-scout",
  "state": "waiting | working | done | error",
  "updated": "2026-10-10T11:30:00Z",
  "lastRun": "2026-10-10T11:42:00Z",
  "summary": "One line about the last run.",
  "message": "Optional: what went wrong, when state is error.",
  "report": "path/to/full-report.md",
  "items": [{ "title": "", "url": "", "category": "", "note": "" }]
}
```

## Adding a new agent

1. Add an entry to `agents.json` with a free `plot` (0–5).
2. Have the agent write `status/<id>.json` in the format above.
3. A new resident moves in.
