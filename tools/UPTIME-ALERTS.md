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

This one watches the database the members' area depends on. It can fail while
the homepage looks perfectly fine — that's the situation where brothers say
"I can't log in" and the site looks OK to you.

## What this does NOT cover

A pinger only knows whether a page answered. It cannot tell that a page loaded
but is broken, that a file leaked, or that a deploy shipped code that won't run.
That is what `tools/check-site.bat` and the daily cloud check are for.

Between the three:

| Problem | Caught by |
|---|---|
| Site totally unreachable, 3am | UptimeRobot (5 min, phones you) |
| Members' area down, homepage fine | UptimeRobot 2nd monitor, or the daily check |
| Deploy shipped broken code | check-site.bat, or the daily check within 24h |
| Something private became public | the daily check (or check-site.bat) |
| Database asleep on the free plan | the daily check — it also prevents it |
