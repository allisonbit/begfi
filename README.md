# BegFi

Static landing page for BegFi — a profile-link + token-launch concept for Robinhood Chain.

## Stack

Plain HTML, CSS and vanilla JS in a single file. No build step, no dependencies, no framework.

## Structure

```
index.html   the entire site (markup, styles and script)
```

## Local preview

Open `index.html` directly in a browser, or serve the folder:

```sh
python -m http.server 8000
```

## Deploy

Hosted on Vercel. Vercel serves `index.html` as a static file; every push to `main` on GitHub redeploys production.

## Note on the UI

The wallet connect, the copy-link button and the "Launch" form are front-end demos. The page says so on screen ("Demo. Nothing is really sent."). No wallet integration, token contract or backend exists yet — the numbers shown in the phone mockup are placeholders, not live data.
