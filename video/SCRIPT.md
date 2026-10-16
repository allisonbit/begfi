# BegFi — everything, explained — narration script

Voice `en-US-AndrewNeural`, rate `+8%`. Each beat is one audio clip and one
visual, so a beat's length is its own narration's length.

## 01 — What BegFi is

*0:00.0 – 0:33.8 · 33.8s*

**01.1** · 5.8s · *card: BegFi, explained*

BegFi is a crypto money-movement platform. One link, any EVM chain, in under a minute.

**01.2** · 8.8s · *page: https://www.begfi.io/*

It answers a question that sounds trivial and is not: how does somebody with no wallet, and no patience, receive crypto from a group chat, or send it to one?

**01.3** · 19.2s · *card: Four products, one engine*

BegFi's answer is four products sharing one identity, one dashboard, one leaderboard, and one money engine. You can beg for crypto, pay somebody with a link, run a campaign that pays people for work, or give crypto away. Everything settles on chain, and the numbers are public. This video walks through all of it, including the parts that are unfinished.

## 02 — Beg pages

*0:33.8 – 1:12.7 · 38.9s*

**02.1** · 12.9s · *page: https://www.begfi.io/leooo*

The oldest product is the beg page, and it is still the simplest money path on the site: a profile at slash your username, with an avatar, a bio, socials, a verified X tick, a QR code and a share card.

**02.2** · 18.5s · *page: https://www.begfi.io/beg/6a7919ab-d862-498e-ac53-64f278f1552a*

Anyone can send the token straight to that wallet. Payment pages and tips are wallet to wallet — BegFi never holds those funds and cannot reverse a transaction. A beg is a request with a goal and a progress bar, and every tip produces a receipt at slash t slash transaction hash: a page you can post that proves money moved.

**02.3** · 7.5s · *page: https://www.begfi.io/begs*

The feed at slash begs is the public wall of them, and the leaderboard ranks everyone who gives, earns and begs across the whole platform.

## 03 — Pay Links

*1:12.7 – 1:53.9 · 41.2s*

**03.1** · 11.1s · *page: https://www.begfi.io/pay/3ab71ac4-54f0-4d3d-b207-80dd8bc10eac*

Product two is Pay Links: a request with an amount and a note. You create one in the dashboard and get a page like this, a QR code for a phone camera, share text, and its own unfurl card.

**03.2** · 14.1s · *card: A request is not a balance*

A Pay Link is deliberately not money. The row in our database is an ask: no balance, no deposit address, no paid flag. The payer's wallet sends straight to the owner's wallet, which is why there is nothing here to lose or to freeze.

**03.3** · 16.0s · *card: Confirmed on chain, then a bell*

Paid is decided by reading the chain. When the indexer confirms a transfer that covers the ask, the run that recorded it settles the request and rings the owner's notification bell. A partial payment is written down but not announced, because calling it paid would be a guess about what the payer meant.

## 04 — Campaigns

*1:53.9 – 2:34.5 · 40.6s*

**04.1** · 15.8s · *page: https://www.begfi.io/earn*

Product three is Earn, where campaigns live. A project funds a pool, writes the rules, and pays people for verified work: posting about the project, joining it, referring it. There are individual campaigns, and project campaigns that run a daily budget over a period.

**04.2** · 13.7s · *card: Fund a pool, pay for work*

Deposits are credited from confirmed on-chain transfers. Rewards are paid once per UTC day, automatically, with no manual approval in between, and posts are verified against X with a pending queue for the ones that need a human to look.

**04.3** · 11.1s · *page: https://www.begfi.io/leaderboard*

Every campaign has its own leaderboard, and the site-wide one ranks everyone across all of them. It is the most built-out part of the platform, and the engine it uses is the engine everything else now shares.

## 05 — Drops

*2:34.5 – 3:29.1 · 54.5s*

**05.1** · 8.1s · *card: Drops*

Product four is the newest: Drops. A drop is a pot of one token, a fixed prize per claim, and a cap on how many people can take it.

**05.2** · 12.8s · *page: https://www.begfi.io/drop/DEMO_DROP_ID*

Someone funds the pot, sets the prize, and shares the link. The first people to open it sign in, claim, and each receives that prize in their own wallet within seconds. One prize per wallet, and one per verified X account.

**05.3** · 11.9s · *page: https://www.begfi.io/drops*

The page shows the pot's arithmetic in full: deposited, paid out, promised, and claimable right now. A claim is paid in full or refused — never partial, and never queued behind an empty pot.

**05.4** · 21.8s · *card: Drops runs on the campaign engine*

What makes Drops interesting is what it did not build. It reuses the campaign payout engine instead of running a second one: the same distributor wallet, the same ledger table, the same lease that makes a double payment impossible, the same kill switch, the same reconciliation. The only genuinely new pieces are how a pot is credited, and a lease that stops two products paying in the same token.

## 06 — The money engine

*3:29.1 – 4:50.1 · 81.0s*

**06.1** · 13.0s · *card: No escrow. One hot wallet.*

So how does the money actually move? There is no escrow contract and no smart-contract custody. Pools are funded to a wallet BegFi controls, and paid out automatically by a single key held by the server: the distributor private key.

**06.2** · 11.1s · *card: One key holds the float*

That is a deliberate trade, and the risks are written down rather than hidden: no escrow means less code to break, but one leaked key would lose everything at once, and there is no hot-cold split yet.

**06.3** · 18.1s · *card: Two layers of truth*

Two independent layers stop a double payment. Money truth: a payout only counts once its transaction is confirmed on chain, and a hash is filed before anyone waits for it. And send truth: an atomic lease, claimed in the database before the send, so two runs that try to pay the same person cannot both win.

**06.4** · 16.1s · *card: Three pools, one money trail*

Everything that leaves the wallet is one row in one ledger, shared by BegFi's own reward pool, every campaign, and every drop. Each send reads the wallet's live token balance first and holds a native-gas floor, so a run stops rather than firing transactions it cannot pay for.

**06.5** · 22.8s · *card: Credit by intent, not by hope*

Then there is attribution, which is harder than it sounds when every pool shares one address. A campaign is credited by token alone. A drop is credited by intent: the funder registers which wallet, which pot, and how much, and the scanner credits only transfers that match. A transfer that matches no intent is credited nowhere, on purpose — guessing would credit somebody else's giveaway with your money.

## 07 — The safety controls

*4:50.1 – 5:46.4 · 56.2s*

**07.1** · 7.7s · *card: Stop, check, alert, record*

Four controls make that engine survivable, and all four exist because a wallet that pays people also has to be able to stop, and to be checked.

**07.2** · 15.1s · *card: The kill switch fails closed*

One: a global kill switch. It is a single row, read at the top of every payout path, and flipped from the admin console. It fails closed: if that row cannot be read, payouts stop. The moment you need a kill switch is the moment the database is misbehaving.

**07.3** · 15.4s · *card: Owed versus held, every hour*

Two: hourly reconciliation. Every hour, a job compares what each token is owed against the distributor's live on-chain balance, records a row per token, and pauses payouts before it alerts a human. Stopping the bleeding comes first; the notification is second.

**07.4** · 18.1s · *card: Gas warning, permanent record*

Three: gas alerting. The same job watches the wallet's native balance against the sweep's own floor and rings the bell while it is under — the alert that prevents a silent stall. Four: an audit log. Every switch flip, automatic pause, sweep and reconciliation writes an append-only row, written by the code that did the thing.

## 08 — Transparency

*5:46.4 – 6:15.0 · 28.6s*

**08.1** · 16.1s · *page: https://www.begfi.io/transparency*

Which brings the most unusual page on the site: slash transparency. It publishes the payout wallet's live balance, what is owed right now, all-time paid, the state of the switch and the reason a human gave for pausing it, the latest reconciliation per token, and the recent audit entries.

**08.2** · 12.5s · *card: Publish the ugly truth too*

It renders bad news as readily as good news — a shortfall, a pause, an unreadable reading. That is the point. A transparency page that only looks good when things are good is a marketing page with a ledger in it.

## 09 — What is not built

*6:15.0 – 7:26.9 · 72.0s*

**09.1** · 19.3s · *card: Custody, addresses, refunds*

Now the honest list, because every product video skips this part. Custody first: every pool still funds one shared address, so there are no per-pool deposit addresses, and there is no automatic refund for an unspent pot. The remainder stays in the payout wallet, and the site says so out loud instead of implying a refund that does not exist.

**09.2** · 19.8s · *card: Sybil resistance is identity only*

Second, sybil resistance. A giveaway or a campaign can be farmed by wallets that are one person without a verified X account. There is no captcha, no clustering by funding source, and no review queue yet. Device fingerprinting existed and was removed on purpose, because it punished shared phones and told honest people to come back tomorrow.

**09.3** · 16.5s · *card: The indexer is behind the chain*

Third, the clock. The indexer is behind the chain — measured at roughly half a million blocks — so anything that depends on it, pay-link settlement and deposit crediting included, arrives late. A funder can accelerate detection by pressing check, and the fix is scanning more windows per run.

**09.4** · 16.3s · *card: One chain, no API, no store*

And fourth, breadth. The site runs on one chain, Robinhood Chain, so Ethereum and Base are a phase rather than a patch. There is no public API or embeddable button yet, no PWA, and no Play Store listing. Those are the next platform milestones, not repairs.

## 10 — Where it goes next

*7:26.9 – 8:03.4 · 36.5s*

**10.1** · 19.9s · *card: What changes first*

So where does it go next? Per-pool deposit addresses, because one change closes attribution, makes refunds possible, and retires the shared-address assumption for all three funding products at once. Then a sybil pass on the claim and submit paths. Then the platform work: more chains, an admin panel that covers everything, and a public API.

**10.2** · 16.6s · *page: https://www.begfi.io/*

Everything in this video is live at begfi dot io, including the books. Nothing on the site is fake data: an unconfigured feature says it is unconfigured, and a wallet that is short says it is short. That is the whole idea — money movement that is fast, and honest about the parts it has not finished.

**Total narration: 8.1 minutes across 33 beats.**
