"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gray-50 px-5">
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-border bg-white shadow-sm">
        <div className="flex flex-col items-center justify-center space-y-3 px-4 pb-2 pt-8 text-center sm:px-16">
          <Link href="/">
            <span className="text-balance text-2xl font-semibold text-gray-800">
              Welcome to Papermark
            </span>
          </Link>
          <p className="text-balance text-sm text-gray-600">
            Sign in with the administrator account configured for this server.
          </p>
        </div>
        <form
          className="flex flex-col gap-4 px-4 py-8 sm:px-16"
          onSubmit={async (event) => {
            event.preventDefault();
            setIsSigningIn(true);

            const result = await signIn("credentials", {
              email,
              password,
              callbackUrl:
                new URLSearchParams(window.location.search).get("next") ??
                "/documents",
              redirect: false,
            });

            if (result?.ok && result.url) {
              window.location.assign(result.url);
              return;
            }

            toast.error("Invalid administrator email or password.");
            setIsSigningIn(false);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoCapitalize="none"
              autoComplete="username"
              autoCorrect="off"
              disabled={isSigningIn}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              disabled={isSigningIn}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          <Button type="submit" loading={isSigningIn}>
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
