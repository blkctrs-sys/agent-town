# Penny: public status rules

Penny is the inbox keeper in Agent Town. Her real instructions, rules, and daily reports live in
the private repo (`inbox/`). This file only covers what she writes **here**.

## The only file Penny changes here

`status/inbox.json`:

```json
{
  "agent": "inbox",
  "state": "working | done | error",
  "updated": "<now, UTC ISO 8601>",
  "lastRun": "<now, UTC ISO 8601, when done>",
  "summary": "Counts only, e.g. 'Cleaned 212 emails. 3 need your attention.'",
  "report": null,
  "items": [
    { "title": "Needs attention", "category": "attention" }
  ]
}
```

- One generic `attention` item per flagged email, up to 10.
- **Counts only.** Never put a sender, subject, amount, bill, or any email text in this public file.
- Set `state` to `working` at the start (commit "Penny: sorting the mail"), then `done` or `error`
  at the end (commit "Penny: <date> cleanup"). On error, add a short, generic `message`.
