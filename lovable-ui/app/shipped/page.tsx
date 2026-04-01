import Navbar from "@/components/Navbar";
import Link from "next/link";

export default function ShippedPage() {
  return (
    <main className="min-h-screen relative overflow-hidden bg-black selection:bg-amber-500/30">
      <Navbar />

      <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] bg-amber-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-yellow-500/10 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4 sm:px-6 lg:px-8 mt-20">
        <div className="max-w-4xl mx-auto text-center">
          
          <div className="mb-6 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold tracking-wider">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            SHOWCASE GALLERY
          </div>

          <h1 className="text-5xl sm:text-6xl md:text-7xl font-extrabold text-transparent bg-clip-text bg-gradient-to-b from-white via-amber-100 to-amber-500 mb-6 tracking-tight drop-shadow-sm">
            Built with Lovabee
          </h1>

          <p className="text-lg sm:text-xl text-amber-100/70 mb-16 max-w-2xl mx-auto font-light">
            A showcase of the most incredible projects, dashboards, and interactive applications pollinated by our community.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto mb-16">
            
            {/* Project 1 */}
            <div className="bg-[#0a0a0a]/80 backdrop-blur-xl rounded-3xl border border-amber-500/20 overflow-hidden group">
              <div className="h-48 bg-gradient-to-br from-amber-600/20 to-yellow-600/10 flex items-center justify-center">
                <span className="text-6xl">📊</span>
              </div>
              <div className="p-6 text-left border-t border-amber-500/10">
                <h3 className="text-xl font-bold text-white mb-2">Fintech Dashboard</h3>
                <p className="text-gray-400 text-sm mb-4">Prompted in 45 words. Contains real-time Recharts integrations and a dark-mode data grid.</p>
                <span className="text-amber-500 text-sm font-medium">View Project →</span>
              </div>
            </div>

            {/* Project 2 */}
            <div className="bg-[#0a0a0a]/80 backdrop-blur-xl rounded-3xl border border-amber-500/20 overflow-hidden group">
              <div className="h-48 bg-gradient-to-br from-purple-600/20 to-amber-600/10 flex items-center justify-center">
                <span className="text-6xl">🛍️</span>
              </div>
              <div className="p-6 text-left border-t border-amber-500/10">
                <h3 className="text-xl font-bold text-white mb-2">E-Commerce Boutique</h3>
                <p className="text-gray-400 text-sm mb-4">A complete Shopify-style storefront with simulated cart states and beautiful Framer Motion animations.</p>
                <span className="text-amber-500 text-sm font-medium">View Project →</span>
              </div>
            </div>

          </div>
          
          <Link href="/" className="inline-block px-8 py-4 bg-amber-600 hover:bg-amber-500 text-black font-bold rounded-full transition-colors">
            Generate Your Next App
          </Link>
        </div>
      </div>
    </main>
  );
}
