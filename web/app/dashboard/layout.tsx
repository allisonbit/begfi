import { DashboardNav } from "@/components/dashboard-nav";
import { NeedsSignIn, NeedsUsername } from "@/components/needs-sign-in";
import { getProfile, getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The dashboard's gate and its navigation, in one place.
 *
 * EVERY PAGE UNDER /dashboard IS COVERED BY THIS. The three states a visitor can
 * be in — no session, a session with no username, and a working account — were
 * previously re-implemented in each page, which is how they drifted: some
 * redirected, some rendered a form, and none of them offered a way to the others.
 * A page cannot be added here without navigation, because the navigation is not
 * something a page provides.
 *
 * The gate decides whether `children` renders at all, so a signed-out visitor
 * never reaches a page that would query on their behalf.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();

  if (!profile) {
    const { signedIn } = await getSession();
    return signedIn ? <NeedsUsername /> : <NeedsSignIn what="your dashboard" />;
  }

  return (
    <div className="mx-auto grid max-w-[1000px] gap-6 px-5 py-8">
      <DashboardNav />
      {children}
    </div>
  );
}
