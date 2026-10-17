import type { Metadata } from "next";
import Link from "next/link";

import { VisibilityToggle } from "@/components/visibility-toggle";
import { shortAddress } from "@/lib/chains";
import { getProfile } from "@/lib/session";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

/**
 * /dashboard/settings — the account switches that are not profile copy.
 *
 * WHY THIS PAGE EXISTS AT ALL. The menu brief asks for Settings, and a settings
 * page with nothing on it is worse than no menu entry: it teaches people the
 * product has options and then shows them a shell. The one real switch the
 * schema already has and no surface exposed is `profiles.is_hidden`, so that is
 * what lives here — a visibility control with a stated consequence, not a
 * decorative toggle.
 *
 * WHAT IS DELIBERATELY NOT HERE. Notification preferences, because there is no
 * preference column and inventing a switch that changes nothing would be a lie.
 * A password, because there is none: the wallet signature is the login. A
 * delete-account button, because account removal cascades through auth and is
 * an operator action, not a button to press by accident.
 */
export default async function SettingsPage() {
  const profile = await getProfile();
  if (!profile) return null;

  return (
    <>
      <header>
        <h1 className="text-[clamp(28px,6vw,40px)] font-extrabold tracking-[-.05em]">Settings</h1>
        <p className="mt-1 text-beg-dim">Account facts and the one visibility switch this site has.</p>
      </header>

      <section className="card p-6">
        <h2 className="text-[16px] font-extrabold">Account</h2>
        <dl className="mt-4 grid gap-3 text-[14px]">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <dt className="text-beg-dim">Username</dt>
            <dd className="font-bold text-beg-ink">
              <Link href={`/${profile.username}`} className="underline decoration-beg-lime decoration-2 underline-offset-2">
                @{profile.username}
              </Link>
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <dt className="text-beg-dim">Wallet</dt>
            <dd className="font-mono text-[13px] text-beg-ink" title={profile.wallet_address}>
              {shortAddress(profile.wallet_address)}
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <dt className="text-beg-dim">X account</dt>
            <dd className="font-bold text-beg-ink">
              {profile.x_handle ? (
                <>
                  @{profile.x_handle}{" "}
                  <span className={profile.x_verified ? "text-beg-lime" : "text-beg-dim"}>
                    {profile.x_verified ? "verified" : "not verified"}
                  </span>
                </>
              ) : (
                <span className="text-beg-dim">none linked</span>
              )}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-[12px] text-beg-dim">
          The username is fixed after claiming. Name, bio, avatar and socials live in{" "}
          <Link href="/dashboard/profile" className="underline underline-offset-2 hover:text-beg-ink">
            Edit profile
          </Link>
          ; the X tick is granted by the verification there.
        </p>
      </section>

      <section className="card p-6">
        <h2 className="text-[16px] font-extrabold">Public profile</h2>
        <p className="mt-2 text-[13px] text-beg-dim">
          Hiding takes your profile page out of public view and removes you from the leaderboards, the sitemap and
          every public list. Your pay links keep working; they simply stop showing your name and avatar. No rows are
          deleted, and you can turn it back on whenever you want.
        </p>
        <div className="mt-4">
          <VisibilityToggle initial={profile.is_hidden} />
        </div>
      </section>

      <section className="card p-6">
        <h2 className="text-[16px] font-extrabold">Where things live</h2>
        <ul className="mt-3 grid gap-2 text-[14px]">
          <li>
            <Link href="/dashboard/notifications" className="underline underline-offset-2 hover:text-beg-ink">
              Notifications
            </Link>{" "}
            <span className="text-beg-dim">— every alert, not just the last five.</span>
          </li>
          <li>
            <Link href="/transparency" className="underline underline-offset-2 hover:text-beg-ink">
              The books
            </Link>{" "}
            <span className="text-beg-dim">— the payout wallet, what is owed and the switch state.</span>
          </li>
          <li>
            <Link href="/terms" className="underline underline-offset-2 hover:text-beg-ink">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-beg-ink">
              Privacy
            </Link>{" "}
            <span className="text-beg-dim">— what this site promises and what it does not.</span>
          </li>
        </ul>
      </section>
    </>
  );
}
