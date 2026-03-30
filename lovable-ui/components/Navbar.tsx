"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

export default function Navbar() {
  const [user, setUser] = useState<User | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    const getUserData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("credits")
          .eq("id", user.id)
          .single();
        if (profile) setCredits(profile.credits);
      }
    };

    getUserData();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
        if (session?.user) {
          supabase
            .from("profiles")
            .select("credits")
            .eq("id", session.user.id)
            .single()
            .then(({ data }) => {
              if (data) setCredits(data.credits);
            });
        }
      }
    );

    // Listen for realtime updates to credits
    const channel = supabase
      .channel("profile-credits")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles" },
        (payload) => {
          if (user && payload.new.id === user.id) {
            setCredits(payload.new.credits);
          }
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [user, supabase]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <nav className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-6 py-4">
      {/* Logo & main navigation */}
      <div className="flex items-center gap-10">
        <a
          href="/"
          className="flex items-center gap-2 text-2xl font-semibold text-white hover:opacity-90 transition-opacity"
        >
          {/* Simple gradient square to mimic Lovable logo */}
          <span className="inline-block w-6 h-6 rounded-sm bg-gradient-to-br from-orange-400 via-pink-500 to-blue-500" />
          Lovable Clone
        </a>

        <div className="hidden md:flex items-center gap-8 text-sm text-gray-300">
          <a href="#" className="hover:text-white transition-colors">
            Community
          </a>
          <a href="#" className="hover:text-white transition-colors">
            Enterprise
          </a>
          <a href="#" className="hover:text-white transition-colors">
            Learn
          </a>
          <a href="#" className="hover:text-white transition-colors">
            Shipped
          </a>
        </div>
      </div>

      {/* Auth buttons */}
      <div className="flex items-center gap-6 text-sm">
        {user ? (
          <>
            {credits !== null && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-900/50 border border-gray-800 rounded-full text-xs font-medium text-blue-400">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-blue-500"
                >
                  <circle cx="12" cy="12" r="8" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
                {credits.toLocaleString()} Credits
              </div>
            )}
            <a
              href="/dashboard"
              className="text-gray-300 hover:text-white transition-colors"
            >
              Dashboard
            </a>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-gray-800 text-white border border-gray-700 rounded-lg font-semibold hover:bg-gray-700 transition-colors"
            >
              Log out
            </button>
          </>
        ) : (
          <>
            <a
              href="/login"
              className="text-gray-300 hover:text-white transition-colors"
            >
              Log in
            </a>
            <a
              href="/signup"
              className="px-4 py-2 bg-white text-black rounded-lg font-semibold hover:bg-gray-100 transition-colors"
            >
              Get started
            </a>
          </>
        )}
      </div>
    </nav>
  );
}
