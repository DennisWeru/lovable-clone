import Navbar from "@/components/Navbar";
import Link from "next/link";

export default function BlogPage() {
  const posts = [
    {
      title: "The Rise of Vibe Coding: Why prompting is the new typing.",
      date: "Oct 12, 2026",
      readTime: "5 min read",
      author: "The Bee Team",
      excerpt: "The traditional boundaries between design and development are collapsing. How Lovabee is leading the charge in natural language engineering."
    },
    {
      title: "How to build a multi-tenant SaaS in 2 minutes.",
      date: "Oct 08, 2026",
      readTime: "8 min read",
      author: "Alex Rivers",
      excerpt: "Deep dive into using advanced agentic mode to scaffold complex databases and auth systems without lifting a finger."
    },
    {
      title: "Security in the age of AI generations.",
      date: "Sep 30, 2026",
      readTime: "12 min read",
      author: "Security Swarm",
      excerpt: "Ensuring isolation, privacy, and compliance when your software engineer is an AI model."
    }
  ];

  return (
    <main className="min-h-screen relative overflow-hidden bg-black selection:bg-amber-500/30">
      <Navbar />

      <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] bg-amber-500/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-yellow-500/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center pt-32 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-20">
            <div className="mb-6 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold tracking-wider uppercase">
              The Swarm Blog
            </div>
            <h1 className="text-5xl sm:text-7xl font-extrabold text-transparent bg-clip-text bg-gradient-to-b from-white via-amber-100 to-amber-500 mb-6 tracking-tight">
              Insights from the hive.
            </h1>
            <p className="text-xl text-amber-100/70 max-w-2xl mx-auto font-light leading-relaxed">
              News, architectural deep-dives, and the future of agentic software engineering.
            </p>
          </div>

          <div className="space-y-8 mb-20">
            {posts.map((post) => (
              <a 
                key={post.title} 
                href="#" 
                className="block p-10 rounded-[2.5rem] bg-[#0a0a0a] border border-gray-800 hover:border-amber-500/50 hover:shadow-[0_0_50px_rgba(245,158,11,0.05)] transition-all duration-500 group"
              >
                <div className="flex items-center gap-4 text-xs font-bold text-amber-600 uppercase tracking-widest mb-6">
                  <span>{post.date}</span>
                  <span className="w-1 h-1 rounded-full bg-amber-500/30" />
                  <span>{post.readTime}</span>
                </div>
                <h3 className="text-3xl font-bold text-white mb-4 group-hover:text-amber-400 transition-colors leading-tight">
                  {post.title}
                </h3>
                <p className="text-gray-450 text-lg leading-relaxed mb-8">
                  {post.excerpt}
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/30" />
                    <span className="text-sm font-medium text-gray-300">{post.author}</span>
                  </div>
                  <span className="text-white font-bold group-hover:translate-x-1 transition-transform">Read More →</span>
                </div>
              </a>
            ))}
          </div>

          <div className="text-center">
            <button className="px-10 py-4 bg-transparent border border-gray-800 text-gray-400 hover:text-white hover:border-gray-500 rounded-full transition-all text-sm font-bold uppercase tracking-widest">
              Load older updates
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
