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

1. Go to **uptimerobot.com** and make a free account.
2. **+ New monitor**
   - Monitor type: **HTTPS**
   - Friendly name: `ZBXi site`
   - URL: `https://zetabetaxi.com`
   - Monitoring interval: **5 minutes** (the free maximum frequency)
3. Under **Alert contacts**, tick your email. To get a phone alert, install the
   UptimeRobot app and enable push — free, unlike their SMS.
4. Save.

That's it. It now loads your homepage every 5 minutes from outside your house
and tells you if it stops answering.

### Optional second monitor, worth 60 seconds

Add a second monitor exactly like the first but with:

- Friendly name: `ZBXi members area (database)`
- URL: `https://wqhhomzbeeveuaskirfl.supabase.co/auth/v1/health`

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
