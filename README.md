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

Nothing on this page asserts anything that has not happened. There is no wallet integration, no token contract and no backend.

- The username box and the phone panel are a **labelled preview**. Typing a name updates the illustration; the "Copy" button copies a real URL string, and the page states plainly that the link does not resolve yet.
- The profile panel shows a **zero empty state** — no balances, no supporter counts, no fabricated wallet address.
- The token section is marked **planned**. The fee splits are the intended design, not live terms, and there is no launch form.
