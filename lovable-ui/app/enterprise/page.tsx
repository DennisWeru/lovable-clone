import Navbar from "@/components/Navbar";
import Link from "next/link";

export default function EnterprisePage() {
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
            FOR TEAMS
          </div>

          <h1 className="text-5xl sm:text-6xl md:text-7xl font-extrabold text-transparent bg-clip-text bg-gradient-to-b from-white via-amber-100 to-amber-500 mb-6 tracking-tight drop-shadow-sm">
            Lovabee Enterprise
          </h1>

          <p className="text-lg sm:text-xl text-amber-100/70 mb-12 max-w-2xl mx-auto font-light">
            Scale your engineering velocity securely with custom AI models, unlimited Daytona sandboxes, and dedicated priority support.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto mb-16">
            <div className="p-8 bg-[#0a0a0a]/80 backdrop-blur-xl rounded-3xl border border-amber-500/20 text-left">
              <h3 className="text-xl font-bold text-amber-400 mb-2">SOC2 Type II</h3>
              <p className="text-gray-400 text-sm">Enterprise-grade security guarantees for all generated code and prompt data.</p>
            </div>
            
            <div className="p-8 bg-[#0a0a0a]/80 backdrop-blur-xl rounded-3xl border border-amber-500/20 text-left">
              <h3 className="text-xl font-bold text-amber-400 mb-2">Custom Models</h3>
              <p className="text-gray-400 text-sm">Plug in your own fine-tuned LLMs directly to the Lovabee workflow engine.</p>
            </div>

            <div className="p-8 bg-[#0a0a0a]/80 backdrop-blur-xl rounded-3xl border border-amber-500/20 text-left">
              <h3 className="text-xl font-bold text-amber-400 mb-2">SSO & SAML</h3>
              <p className="text-gray-400 text-sm">Seamlessly integrate with your massive corporate identity providers.</p>
            </div>
          </div>

          <a href="mailto:sales@lovabee.vercel.app" className="inline-block px-8 py-4 bg-transparent border-2 border-amber-500 text-amber-500 hover:bg-amber-500/10 font-bold rounded-full transition-colors">
            Contact Sales
          </a>
        </div>
      </div>
    </main>
  );
}
