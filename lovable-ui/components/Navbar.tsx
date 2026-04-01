"use client";

import React, { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

export default function Navbar() {
  const [user, setUser] = useState<User | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  // Memoize supabase client to prevent useEffect from re-running on every render
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const userRef = React.useRef<User | null>(null);
  
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    let isMounted = true;

    const fetchCredits = async (userId: string) => {
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("credits")
          .eq("id", userId)
          .single();
        
        if (isMounted && profile) {
          setCredits(profile.credits);
        }
      } catch (e) {
        console.error("Error fetching credits:", e);
      }
    };

    const initializeAuth = async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (!isMounted) return;
        
        const currentUser = data?.user ?? null;
        setUser(currentUser);
        
        if (currentUser) {
          await fetchCredits(currentUser.id);
        }
      } catch (e) {
        console.error("Auth init error:", e);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!isMounted) return;
        
        const newUser = session?.user ?? null;
        setUser(newUser);
        
        if (newUser) {
          await fetchCredits(newUser.id);
        } else {
          setCredits(null);
        }
        
        // Ensure loading is finished on auth state changes as well
        setIsLoading(false);
      }
    );

    // Listen for realtime updates to credits
    const channel = supabase
      .channel("profile-credits")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles" },
        (payload) => {
          if (isMounted && userRef.current && payload.new.id === userRef.current.id) {
            setCredits(payload.new.credits);
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [supabase]);

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
          {/* Hexagon gradient logo to mimic Lovabee */}
          <span className="inline-block w-6 h-6 bg-gradient-to-br from-yellow-400 via-amber-500 to-orange-500" style={{ clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)' }} />
          Lovabee
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
      <div className="flex items-center gap-6 text-sm min-w-[200px] justify-end">
        {isLoading ? (
          <div className="flex items-center gap-4 animate-pulse">
            <div className="h-4 w-12 bg-gray-800 rounded" />
            <div className="h-10 w-28 bg-gray-800 rounded-lg" />
          </div>
        ) : user ? (
          <>
            {credits !== null && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-900/50 border border-gray-800 rounded-full text-xs font-medium text-amber-400">
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
                  className="text-amber-500"
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
