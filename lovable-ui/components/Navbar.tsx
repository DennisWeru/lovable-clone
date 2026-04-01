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
        // Get user from Supabase - this may take time if token refresh is needed
        const { data } = await supabase.auth.getUser();
        if (!isMounted) return;
        
        const currentUser = data?.user ?? null;
        setUser(currentUser);
        
        // Stop loading as soon as we have a definitive answer about the user, 
        // don't wait for credits to avoid causing a stuck skeleton loader.
        setIsLoading(false);
        
        if (currentUser) {
          fetchCredits(currentUser.id);
        }
      } catch (e) {
        console.error("Auth init error:", e);
        if (isMounted) setIsLoading(false);
      }
    };

    // Safety timeout: Ensure the loading skeleton doesn't stay stuck forever 
    // even if Supabase auth calls hang (e.g. due to corrupted local storage)
    const safetyTimeout = setTimeout(() => {
      if (isMounted) {
        setIsLoading(false);
      }
    }, 4000);

    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!isMounted) return;
        
        const newUser = session?.user ?? null;
        setUser(newUser);
        
        // Always stop main loading state when auth state changes
        setIsLoading(false);
        
        if (newUser) {
          fetchCredits(newUser.id);
        } else {
          setCredits(null);
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
          if (isMounted && userRef.current && payload.new.id === userRef.current.id) {
            setCredits(payload.new.credits);
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      clearTimeout(safetyTimeout);
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
          className="flex items-center gap-2.5 text-2xl font-bold text-white hover:opacity-90 transition-all group"
        >
          {/* Reimagined Hexagon Logo: Abstract 'B' Bee */}
          <div className="relative w-8 h-8 flex items-center justify-center">
            <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-[0_0_12px_rgba(245,158,11,0.4)]">
              <defs>
                <linearGradient id="bee-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#fcd34d" />
                  <stop offset="50%" stopColor="#f59e0b" />
                  <stop offset="100%" stopColor="#b45309" />
                </linearGradient>
              </defs>
              {/* Main Hexagon Frame */}
              <path 
                d="M50 2 L93.3 25 L93.3 75 L50 98 L6.7 75 L6.7 25 Z" 
                fill="none" 
                stroke="url(#bee-grad)" 
                strokeWidth="4"
                className="opacity-40"
              />
              {/* The Styled 'B' / Bee Wings */}
              <path 
                d="M50 20 L50 80 M50 20 C75 20 85 35 50 50 C85 65 75 80 50 80" 
                stroke="url(#bee-grad)" 
                strokeWidth="12" 
                strokeLinecap="round" 
                fill="none"
                className="group-hover:stroke-white transition-colors duration-300"
              />
              {/* Floating 'Stoker' / Antenna Dot */}
              <circle cx="50" cy="12" r="5" fill="url(#bee-grad)" className="animate-bounce" style={{ animationDuration: '2s' }} />
            </svg>
          </div>
          <span className="tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-amber-200">Lovabee</span>
        </a>

        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-400">
          <a href="/pricing" className="hover:text-white transition-colors">
            Pricing
          </a>
          <a href="/showcase" className="hover:text-white transition-colors">
            Showcase
          </a>
          <a href="/docs" className="hover:text-white transition-colors">
            Docs
          </a>
          <a href="/blog" className="hover:text-white transition-colors">
            Blog
          </a>
          <a href="/security" className="hover:text-white transition-colors">
            Security
          </a>
        </div>
      </div>

      {/* Auth & Community buttons */}
      <div className="flex items-center gap-6 text-sm min-w-[200px] justify-end">
        <a 
          href="https://discord.gg/lovabee" 
          target="_blank" 
          rel="noreferrer"
          className="hidden lg:flex items-center gap-1.5 text-gray-400 hover:text-white transition-colors"
          title="Join our Discord Swarm"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.419c0 1.334-.956 2.419-2.157 2.419zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.419c0 1.334-.946 2.419-2.157 2.419z"/></svg>
        </a>
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
