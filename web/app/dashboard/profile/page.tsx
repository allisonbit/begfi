import type { Metadata } from "next";
import Link from "next/link";
import { NeedsSignIn, NeedsUsername } from "@/components/needs-sign-in";
import { ProfileForm } from "@/components/profile-form";
import { getProfile, getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Edit profile" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const profile = await getProfile();

  if (!profile) {
    const { signedIn } = await getSession();
    return signedIn ? <NeedsUsername /> : <NeedsSignIn what="your profile" />;
  }

  return (
    <div className="mx-auto grid max-w-[1000px] gap-6 px-5 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[clamp(32px,7vw,48px)] font-extrabold tracking-[-.05em]">Edit profile</h1>
        <Link href="/dashboard" className="text-[13px] text-beg-dim underline underline-offset-2">
          Back to dashboard
        </Link>
      </header>

      <ProfileForm profile={profile} />
    </div>
  );
}
