import Navbar from "@/components/Navbar";
import Link from "next/link";

export default function CommunityPage() {
  return (
    <main className="min-h-screen relative overflow-hidden bg-black selection:bg-amber-500/30">
      <Navbar />

      {/* Honeycomb ambient glows */}
      <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] bg-amber-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-yellow-500/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4 sm:px-6 lg:px-8 mt-20">
        <div className="max-w-4xl mx-auto text-center">
          
          <div className="mb-6 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold tracking-wider">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            LOVABEE COMMUNITY
          </div>

          <h1 className="text-5xl sm:text-6xl md:text-7xl font-extrabold text-transparent bg-clip-text bg-gradient-to-b from-white via-amber-100 to-amber-500 mb-6 tracking-tight drop-shadow-sm">
            Join the Swarm
          </h1>

          <p className="text-lg sm:text-xl text-amber-100/70 mb-12 max-w-2xl mx-auto font-light">
            Connect with thousands of builders using Lovabee to ship beautiful code every day. Share your prompts, help others debug, and showcase your best work.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto mb-16">
            <a href="#" className="p-8 bg-[#0a0a0a]/80 backdrop-blur-xl rounded-3xl border border-amber-500/20 hover:border-amber-500/50 hover:shadow-[0_0_40px_rgba(245,158,11,0.1)] transition-all duration-300 text-left group">
              <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center mb-6 border border-amber-500/20 group-hover:scale-110 transition-transform">
                <span className="text-xl">💬</span>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Discord Server</h3>
              <p className="text-gray-400">Join real-time discussions, ask questions, and hang out with the team.</p>
            </a>
            
            <a href="#" className="p-8 bg-[#0a0a0a]/80 backdrop-blur-xl rounded-3xl border border-amber-500/20 hover:border-amber-500/50 hover:shadow-[0_0_40px_rgba(245,158,11,0.1)] transition-all duration-300 text-left group">
              <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center mb-6 border border-amber-500/20 group-hover:scale-110 transition-transform">
                <span className="text-xl">🐙</span>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">GitHub Discussions</h3>
              <p className="text-gray-400">Read our RFCs, contribute to the open-source tooling, and vote on features.</p>
            </a>
          </div>

          <Link href="/" className="inline-block px-8 py-4 bg-amber-600 hover:bg-amber-500 text-black font-bold rounded-full transition-colors">
            Start Generating Now
          </Link>
        </div>
      </div>
    </main>
  );
}
