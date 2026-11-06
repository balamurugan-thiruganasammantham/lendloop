"use client";

import { useRouter } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { ProfileForm } from "@/features/authentication/ProfileForm";
import { useViewer } from "@/features/authentication/ViewerContext";
import styles from "./onboarding.module.scss";

export default function OnboardingPage() {
  const viewer = useViewer();
  const router = useRouter();
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <Logo />
        <div>
          <p className={styles.eyebrow}>Welcome{viewer.name ? `, ${viewer.name.split(" ")[0]}` : ""}</p>
          <h1>Set up your neighbour profile</h1>
          <p className={styles.lede}>
            Lenders see your verified history before approving a request, so a clear profile helps. Your exact location is never shown.
          </p>
        </div>
        <ProfileForm onboarding onDone={() => router.replace("/explore")} />
      </div>
    </main>
  );
}
