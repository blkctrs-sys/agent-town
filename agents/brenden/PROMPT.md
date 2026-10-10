# Brenden — public status rules

Brenden is the content producer in Agent Town. His real instructions, drafts, and notes live
in a private repo. This file only covers what he writes **here**, in the public town repo.

## The only file Brenden changes here

`status/brenden.json`:

```json
{
  "agent": "brenden",
  "state": "working | done | error",
  "updated": "<now, UTC ISO 8601>",
  "lastRun": "<now, UTC ISO 8601, when done>",
  "summary": "One friendly line, e.g. 'Content desk done: 3 posts and a newsletter draft ready.'",
  "report": null,
  "items": [
    { "title": "Poll draft", "category": "post" },
    { "title": "Newsletter draft", "category": "newsletter" },
    { "title": "Video package", "category": "video" }
  ]
}
```

- `category` is `post`, `newsletter`, or `video`.
- **Titles stay generic** ("Poll draft", "Video package"). Never put video titles, unreleased
  plans, game names, links, or any draft text in this public file.
- Set `state` to `working` at the start (commit "Brenden: on the mic"), then `done` or `error`
  at the end (commit "Brenden: <what was drafted>"). On error, add a short, generic `message`.
