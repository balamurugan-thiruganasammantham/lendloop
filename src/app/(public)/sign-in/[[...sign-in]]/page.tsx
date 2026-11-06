import { SignIn } from "@clerk/nextjs";
import { AuthFrame } from "@/components/layout/AuthFrame";

export default function SignInPage() {
  return (
    <AuthFrame title="Welcome back" subtitle="Sign in to borrow and lend tools in your neighbourhood.">
      {/*
        withSignUp: a first-time visitor who picks "Continue with Google" here is turned into a
        new account inside this route (/sign-in/create/...), including Clerk's bot-protection
        check. Without it Clerk can't finish that hand-off and shows "External Account was not found".
      */}
      <SignIn withSignUp />
    </AuthFrame>
  );
}
