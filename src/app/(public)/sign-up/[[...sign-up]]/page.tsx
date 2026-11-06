import { SignUp } from "@clerk/nextjs";
import { AuthFrame } from "@/components/layout/AuthFrame";

export default function SignUpPage() {
  return (
    <AuthFrame title="Join your neighbourhood" subtitle="Create an account to request tools and list your own.">
      <SignUp />
    </AuthFrame>
  );
}
