# callout

## Git

- Follow the Git law in Jeff's `~/AGENTS.md` (2026-11-03). `prod` is the default branch and the finished product. All work happens on `dev`. Branch `task/<id>-<slug>` from `origin/dev`, open the PR into `dev`, never push or force-push `prod`, `main` or `dev`, and end every commit with `Task:`, `Agent:` and `Agent-Session:` trailers. `prod` changes only through a promotion PR from `dev`, and every merge waits for Jeff's approval.
- Follow the [GitHub Flow skill](https://github.com/Jeff-Kazzee/github-skills/blob/649e340019a49f29d27bc940f0822d2c815dff8e/github-flow/SKILL.md) for task branches and pull requests into `dev`.
