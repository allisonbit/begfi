import type { Metadata } from "next";
import Link from "next/link";
import { ProfileForm } from "@/components/profile-form";
import { SiteNav } from "@/components/site-nav";
import { requireProfile } from "@/lib/session";

export const metadata: Metadata = { title: "Edit profile" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const profile = await requireProfile();

  return (
    <div className="mx-auto max-w-[1000px] px-5">
      <SiteNav />
      <main className="grid gap-6 py-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-[clamp(32px,7vw,48px)] font-extrabold tracking-[-.05em]">Edit profile</h1>
          <Link href="/dashboard" className="text-[13px] text-beg-dim underline underline-offset-2">
            Back to dashboard
          </Link>
        </header>

        <ProfileForm profile={profile} />
      </main>
    </div>
  );
}
