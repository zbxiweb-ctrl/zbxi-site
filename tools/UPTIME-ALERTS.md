# Getting a text when the site goes down

Five minutes, free, no card. This is the one piece Claude can't do for you —
it needs your phone number and your signup.

## Why bother, when Cloudflare doesn't go down?

It isn't really about Cloudflare. It's about the two things that *would* take
the site off the internet quietly:

- **The domain isn't renewed.** zetabetaxi.com stops resolving. Nothing warns you.
- **A billing or account problem** at Cloudflare or the registrar.

Both are silent. Nobody emails you "your site is gone." A pinger does.

## Set it up (UptimeRobot)

Signup and your first monitor are the same form — you do not create an account
and then go hunting for an "add monitor" button.

1. Go to **https://uptimerobot.com/signUp**
2. **Website to monitor** — type `zetabetaxi.com`
3. **Create your account** — your email address.
   Or press **Google** instead and skip having another password to remember.
4. Press **Register**, then confirm from the email they send.

That is the first monitor done. It now loads your homepage every 5 minutes from
outside your house and tells you if it stops answering.

That's it. It now loads your homepage every 5 minutes from outside your house
and tells you if it stops answering.

### Optional second monitor, worth 60 seconds

Add a second monitor exactly like the first but with:

- Friendly name: `ZBXi members area (database)`
- URL:
  `https://wqhhomzbeeveuaskirfl.supabase.co/rest/v1/events?select=id&limit=1&apikey=sb_publishable_BWpWxARZc4e4zATsDfMrMQ_w88RcFbJ`

Two things about that URL, both learned the hard way:

- **The key has to be in it.** Without one, Supabase answers "no API key found"
  and the monitor sits at Down forever. It is safe here — that is the
  *publishable* key, already in the site's code and sent to every visitor.
- **It has to answer a HEAD request.** UptimeRobot sends HEAD, not GET. The
  obvious-looking `/auth/v1/health` answers GET fine but returns **405** to
  HEAD, which is a permanently-red monitor. The `/rest/v1/events` query above
  answers 200 to both, and is a better check anyway: it proves the database
  itself is answering queries, not just that the login service is running.
  A stranger calling it gets `[]` — row-level security hides the rows.

This one earns its place twice over:

1. It watches the database the members' area depends on. That can fail while the
   homepage looks perfectly fine — the situation where brothers say "I can't log
   in" and the site looks OK to you.
2. **It keeps the database awake.** Supabase's free plan puts a project to sleep
   after about a week with no activity, which would take down sign-in, the
   roster, the gallery and the board while the homepage carried on looking fine.
   A monitor touching it every 5 minutes means it is never idle.

After you save it, check that UptimeRobot shows it **Up** within a few minutes.
If it shows Down while the site plainly works in your browser, the monitor is
being turned away by bot protection rather than finding a real outage — tell
Claude and it can sort the exception out.

## What this does NOT cover

A pinger only knows whether a page answered. It cannot tell that a page loaded
but is broken, that a file leaked, or that a deploy shipped code that won't run.
That is what `tools/check-site.bat` is for.

Between the two:

| Problem | Caught by |
|---|---|
| Site totally unreachable, 3am | UptimeRobot — the only one that wakes you |
| Members' area down, homepage fine | UptimeRobot 2nd monitor |
| Database asleep on the free plan | UptimeRobot 2nd monitor — it also prevents it |
| Deploy shipped broken code | check-site.bat (run it after Claude changes anything) |
| Something private became public | check-site.bat |
| A page loads but is quietly broken | check-site.bat |

The split is: **UptimeRobot answers "is it reachable", around the clock, without
you. check-site.bat answers "is it actually right", when you ask.**


## Why there isn't a scheduled Claude check

There was going to be one — a cloud agent running this health check once a day.
It was built, scheduled, and then removed, because it could not do the job:
Cloudflare's bot protection refuses requests from datacenter addresses, so from
Anthropic's cloud the site and the database both answer "403 forbidden". The
agent read that as a total outage and, on its first two runs, opened alarming
GitHub issues and pushed a "SITE IS DOWN" alert to a phone — while the site was
perfectly healthy the whole time.

A monitor that cries wolf every morning is worse than no monitor, because it
teaches you to ignore the one alert that is real. So that layer is switched off
(the routine still exists, disabled, if it is ever worth revisiting with a
Cloudflare exception for the runner).

What covers the same ground instead:

- **UptimeRobot** watches from ordinary monitoring addresses, which Cloudflare
  is far happier with, and it phones you — which the daily agent never could.
- **The second monitor above** keeps the database awake, which was the other
  reason the daily job existed.
- **`check-site.bat`** runs from your own machine, where nothing blocks it, and
  gives the deep answers a pinger cannot.
