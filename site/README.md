# Callout landing page and signup

Static page plus one serverless function (PRD 10a). Hosted by the little ai
company. Deploys as-is to Vercel (`vercel --cwd site`) or any host that runs
Node functions under `api/`.

Environment for the signup function:

| Variable | Meaning |
|---|---|
| `RESEND_API_KEY` | Resend API key |
| `RESEND_AUDIENCE_ID` | The audience that is the beta roster |
| `SIGNUP_FROM` | Sender, e.g. `Callout <beta@yourdomain>` (domain verified in Resend) |
| `SIGNUP_INBOX` | Shared partner inbox that gets a copy of every signup |
| `SIGNUP_CAP` | Wave-one cap, default 20 |

Wave logic (L3a): contacts tagged `wave1` in `first_name` count toward the
cap. Signup 21 and later are tagged `waitlist`, get the waitlist message, and
still receive a confirmation. Export the roster from Resend when inviting.

Nothing is published until both partners approve the copy and the brand
treatment. Asset paths under `assets/` are listed in `docs/ASSETS.md`.

Local test of the validator:

```sh
node --input-type=module -e "import('./api/signup.ts')" # needs a TS loader; see test/site.test.ts instead
```
