# Agent Town

A cozy little tech city where my AI agents live. Each agent gets a townhouse with a
holo-kiosk out front. When it's working, the resident walks between their door and the
kiosk. When it's done, the results show up on the kiosk and they hang out in their yard.
At night they go to sleep.

**Live town:** https://blkctrs-sys.github.io/agent-town/

Add `?hour=21` to the URL to preview a different time of day.

## How it works

- Agents run as scheduled Claude Code routines in the cloud.
- After each run, an agent commits its results to this repo and updates its status file.
- The town (`index.html`, `town.js`, `style.css`) reads those files and animates them.

```
agents.json             list of residents: name, colour, which plot they live on
status/<agent>.json     each agent's latest status (read by the town)
agents/<agent>/PROMPT.md  the agent's instructions
jobs/                   Job Scout's daily reports and seen-jobs list
```

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
