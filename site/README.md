# Callout site

Static page hosted on GitHub Pages at
https://the-little-ai-company.github.io/callout/ from the `site/` folder.
`.github/workflows/pages.yml` deploys it on every push to `main` that touches
`site/`. No build step: edit `index.html` and `styles.css` and push.

The download button links to
`https://github.com/The-Little-AI-Company/callout/releases/latest/download/Callout-Setup.exe`,
a stable name the release workflow publishes on every `v*` tag. The page also
reads the GitHub releases API to show the version and date.

Style follows the Vivary site system (warm dark ground, thin rules, amber for
the record, lime for the one action) with different faces: Bricolage
Grotesque for display, Fraunces italic for the mascot's voice, IBM Plex Mono
for body and record.

## Publishing a release

```sh
git tag v0.2.0
git push origin v0.2.0
```

The `build` workflow tests, builds the Windows installer, and creates the
GitHub Release with `Callout-Setup.exe` and `Callout.msi` attached.

## Signup (optional)

`api/signup.ts` is a Resend-backed serverless signup handler from the private
beta plan (PRD 10a), written for Vercel-style hosting. GitHub Pages cannot run
it, and the app is public now, so the page links to GitHub Releases and Issues
instead. Keep the function if a waitlist is wanted later; its environment is
documented in the file header and in `.env.example`.

Assets under `assets/` are listed in `docs/ASSETS.md`. Until the
art lands, `placeholder-mascot.svg` stands in.
