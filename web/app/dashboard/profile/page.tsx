import type { Metadata } from "next";
import { ProfileForm } from "@/components/profile-form";
import { getProfile } from "@/lib/session";

export const metadata: Metadata = { title: "Edit profile" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const profile = await getProfile();
  if (!profile) return null;

  return (
    <>
      <header>
        <h1 className="text-[clamp(28px,6vw,40px)] font-extrabold tracking-[-.05em]">Edit profile</h1>
        <p className="mt-1 text-beg-dim">
          Your avatar, the name people see, and your bio. Your username is fixed.
        </p>
      </header>

      <ProfileForm profile={profile} />
    </>
  );
}
