import Navbar from "@/components/Navbar";
import Link from "next/link";

export default function DocsPage() {
  const guides = [
    { title: "Introduction", description: "Learn the core concepts of Lovabee and Vibe Coding." },
    { title: "First Project", description: "A step-by-step guide to generating your first web application." },
    { title: "Custom Models", description: "How to swap worker bee models for specialized tasks." },
    { title: "Deploying", description: "The lifecycle of a project from chat to production URL." },
    { title: "GitHub Sync", description: "Eject your code or keep it in sync with remote repositories." },
    { title: "Credits & Limits", description: "How the economy of the hive works." }
  ];

  return (
    <main className="min-h-screen relative overflow-hidden bg-black selection:bg-amber-500/30">
      <Navbar />

      <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] bg-amber-500/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-yellow-500/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center pt-32 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-20">
            <div className="mb-6 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold tracking-wider uppercase">
              Documentation
            </div>
            <h1 className="text-5xl sm:text-7xl font-extrabold text-transparent bg-clip-text bg-gradient-to-b from-white via-amber-100 to-amber-500 mb-6 tracking-tight">
              Learn the way.
            </h1>
            <p className="text-xl text-amber-100/70 max-w-2xl mx-auto font-light leading-relaxed">
              Everything you need to know about building, scaling, and managing your swarm-powered applications.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-20">
            {guides.map((guide) => (
              <a 
                key={guide.title} 
                href="#" 
                className="p-8 rounded-3xl bg-[#0a0a0a] border border-gray-800 hover:border-amber-500/50 hover:shadow-[0_0_40px_rgba(245,158,11,0.05)] transition-all duration-300 group"
              >
                <h3 className="text-xl font-bold text-white mb-2 group-hover:text-amber-400 transition-colors uppercase tracking-tight">{guide.title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed mb-6">
                  {guide.description}
                </p>
                <span className="text-amber-600 text-xs font-bold group-hover:text-amber-400 transition-colors">Read Article ↗</span>
              </a>
            ))}
          </div>

          <div className="flex flex-col md:flex-row gap-8">
            <div className="flex-1 p-10 rounded-[2.5rem] bg-gradient-to-br from-amber-500/5 to-transparent border border-amber-500/10">
              <h3 className="text-2xl font-bold text-white mb-4">Lovabee Academy</h3>
              <p className="text-gray-400 text-sm mb-6 leading-relaxed">
                Watch our video tutorials on how to move from a single prompt to a complex SaaS product using Lovabee&apos;s agentic mode.
              </p>
              <button className="px-6 py-3 bg-white text-black font-bold rounded-xl hover:bg-gray-200 transition-colors">
                Watch Videos
              </button>
            </div>
            <div className="flex-1 p-10 rounded-[2.5rem] bg-gray-900/30 border border-gray-800">
              <h3 className="text-2xl font-bold text-white mb-4">API Reference</h3>
              <p className="text-gray-400 text-sm mb-6 leading-relaxed">
                Connect your existing workflows to our generation engine via our REST API and Webhook system.
              </p>
              <button className="px-6 py-3 bg-transparent border border-gray-700 text-white font-bold rounded-xl hover:bg-gray-800 transition-colors">
                View API Docs
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
