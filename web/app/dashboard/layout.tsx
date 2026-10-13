import { DashboardTabs } from "@/components/dashboard-tabs";
import { NeedsSignIn, NeedsUsername } from "@/components/needs-sign-in";
import { isAdminWallet } from "@/lib/earn";
import { getProfile, getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The dashboard's gate and its tab bar, in one place.
 *
 * EVERY PAGE UNDER /dashboard IS COVERED BY THIS. The three states a visitor can
 * be in — no session, a session with no username, and a working account — are
 * decided here, so no tab has to re-implement either. The gate decides whether
 * `children` renders at all: a signed-out visitor never reaches a page that
 * would query on their behalf.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();

  if (!profile) {
    const { signedIn } = await getSession();
    return signedIn ? <NeedsUsername /> : <NeedsSignIn what="your dashboard" />;
  }

  /* The Earn Review console is an admin tab and only renders for one. */
  const isAdmin = isAdminWallet(profile.wallet_address);

  return (
    <div className="safe-x mx-auto grid max-w-[1000px] gap-6 py-8">
      <DashboardTabs extraTabs={isAdmin ? [{ slug: "earn", label: "Earn review" }] : []} />
      {children}
    </div>
  );
}
