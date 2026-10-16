import { DashboardShell } from "@/components/dashboard-shell";
import { NeedsSignIn, NeedsUsername } from "@/components/needs-sign-in";
import { isAdminWallet } from "@/lib/earn";
import { getProfile, getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The dashboard's gate and its shell, in one place.
 *
 * EVERY PAGE UNDER /dashboard IS COVERED BY THIS. The three states a visitor can
 * be in — no session, a session with no username, and a working account — are
 * decided here, so no tab has to re-implement either. The gate decides whether
 * `children` renders at all: a signed-out visitor never reaches a page that
 * would query on their behalf.
 *
 * WHY THE SHELL SITS INSIDE THE GATE. Navigation is only drawn for someone who
 * has somewhere to go. A signed-out visitor gets the sign-in card and no menu,
 * rather than a rail of links that all redirect back to the same card.
 *
 * THE GRID IS THE SHELL. `md:grid-cols-[210px_1fr]` puts the rail in the first
 * column and the page in the second; on phones the rail's mobile tab row is the
 * only thing in the first row and the page follows, because a `display:none`
 * element is not a grid item at all — which is why `DashboardShell` renders the
 * two navs in that order. `min-w-0` on the content column is not cosmetic: a
 * grid child defaults to `min-width:auto`, so a wide table or a long address
 * would push the column past the viewport and scroll the whole page sideways.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();

  if (!profile) {
    const { signedIn } = await getSession();
    return signedIn ? <NeedsUsername /> : <NeedsSignIn what="your dashboard" />;
  }

  /* The Earn review console is an admin section and only renders for one. */
  const isAdmin = isAdminWallet(profile.wallet_address);

  return (
    <div className="safe-x mx-auto grid max-w-[1100px] gap-8 py-8 md:grid-cols-[210px_1fr]">
      <DashboardShell isAdmin={isAdmin} username={profile.username} />
      <div className="grid min-w-0 gap-6">{children}</div>
    </div>
  );
}
