"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import ModelSelector from "@/components/ModelSelector";

export default function Home() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");

  const [model, setModel] = useState("google/gemini-3.1-flash-lite-preview"); // Update default model (Gemini 3.1 Flash Lite)

  const handleGenerate = () => {
    if (!prompt.trim()) return;

    // Navigate to generate page with prompt and model selection
    router.push(`/generate?prompt=${encodeURIComponent(prompt)}&model=${encodeURIComponent(model)}`);
  };

  return (
    <main className="min-h-screen relative overflow-hidden bg-black selection:bg-amber-500/30">
      {/* Navbar */}
      <Navbar />

      {/* Honeycomb pattern background */}
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={{ 
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='56' height='98' viewBox='0 0 56 98' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23f59e0b' fill-opacity='0.05'%3E%3Cpath d='M27.98 18.5l26 15v30l-26 15L2 63.5v-30l25.98-15zM6 35.8v25.4l21.98 12.68 22-12.7V35.8l-22-12.68L6 35.8z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")"
        }}
      />

      {/* Ambient glows behind the UI */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-amber-500/10 rounded-full blur-[120px] pointer-events-none animate-pulse-slow" />
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-yellow-500/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Floating abstract hexagons */}
      <div className="absolute top-32 left-10 w-32 h-32 bg-amber-600/10 backdrop-blur-3xl animate-blob" style={{ clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)' }} />
      <div className="absolute bottom-40 right-10 w-48 h-48 bg-yellow-500/10 backdrop-blur-3xl animate-blob animation-delay-2000" style={{ clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)' }} />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center justify-center min-h-[calc(100vh-80px)] px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto text-center">
          
          <div className="mb-6 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold tracking-wider">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            POWERED BY AI & DAYTONA
          </div>

          <h1 className="text-5xl sm:text-6xl md:text-7xl font-extrabold text-transparent bg-clip-text bg-gradient-to-b from-white via-amber-100 to-amber-500 mb-6 tracking-tight drop-shadow-sm">
            Build something beautiful.<br />Effortlessly.
          </h1>

          <p className="text-lg sm:text-xl text-amber-100/70 mb-12 max-w-2xl mx-auto font-light">
            Bring your ideas to life instantly with Lovabee. The swarm intelligence writes the code, spins up the environment, and deploys it in seconds.
          </p>

          {/* Input Section */}
          <div className="relative max-w-3xl mx-auto">
            <div className="mb-4 flex flex-col sm:flex-row items-center justify-between gap-4 px-2">
              <span className="text-sm font-semibold text-amber-500/80 uppercase tracking-widest pl-2">Select your worker bee model</span>
              <div className="w-[300px]">
                <ModelSelector
                  value={model}
                  onChange={(val) => setModel(val)}
                />
              </div>
            </div>
            
            {/* The main input box */}
            <div className="relative flex flex-col bg-[#0a0a0a]/80 backdrop-blur-xl rounded-3xl border border-amber-500/30 shadow-[0_0_50px_rgba(245,158,11,0.1)] focus-within:border-amber-400/60 focus-within:shadow-[0_0_80px_rgba(245,158,11,0.2)] transition-all duration-500 group">
              
              <textarea
                placeholder="Ask Lovabee to craft a beautiful portfolio, an interactive dashboard, or a complete web app..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleGenerate();
                  }
                }}
                className="w-full px-6 py-5 bg-transparent text-white placeholder-amber-500/40 focus:outline-none text-xl resize-none min-h-[140px] max-h-[400px]"
                rows={3}
              />

              {/* Action bar inside input */}
              <div className="flex items-center justify-between px-4 pb-4 pt-2">
                <div className="flex items-center gap-2 text-amber-500/40 text-xs font-mono ml-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  <span>Shift + Enter for new line</span>
                </div>
                
                <button
                  onClick={handleGenerate}
                  disabled={!prompt.trim()}
                  className="relative group/btn disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {/* Hexagon Send Button Background */}
                  <div className="absolute inset-0 bg-gradient-to-r from-yellow-500 to-amber-600 group-hover/btn:from-yellow-400 group-hover/btn:to-amber-500 transition-colors" style={{ clipPath: 'polygon(15% 0%, 85% 0%, 100% 50%, 85% 100%, 15% 100%, 0% 50%)' }} />
                  <div className="relative px-8 py-3 flex items-center justify-center text-black font-bold gap-2">
                    {false ? (
                      <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : (
                      <>
                        <span>Generate</span>
                        <svg className="h-4 w-4 transform group-hover/btn:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                      </>
                    )}
                  </div>
                </button>
              </div>
            </div>

            {/* Example prompts */}
            <div className="mt-10">
              <p className="text-amber-500/60 text-xs mb-4 font-semibold tracking-widest uppercase">TRY THESE FLOWERS</p>
              <div className="flex flex-wrap justify-center gap-3">
                <button onClick={() => setPrompt("Create a modern blog website with markdown support")} className="px-5 py-2.5 text-sm text-amber-200/80 bg-black/40 backdrop-blur-sm rounded-full hover:bg-amber-500/20 hover:text-amber-100 hover:border-amber-500/60 transition-all duration-300 border border-amber-500/20 hover:-translate-y-0.5 whitespace-nowrap shadow-sm">
                  Blog website
                </button>
                <button onClick={() => setPrompt("Build a portfolio website with project showcase")} className="px-5 py-2.5 text-sm text-amber-200/80 bg-black/40 backdrop-blur-sm rounded-full hover:bg-amber-500/20 hover:text-amber-100 hover:border-amber-500/60 transition-all duration-300 border border-amber-500/20 hover:-translate-y-0.5 whitespace-nowrap shadow-sm">
                  Portfolio site
                </button>
                <button onClick={() => setPrompt("Create an e-commerce product catalog with shopping cart")} className="px-5 py-2.5 text-sm text-amber-200/80 bg-black/40 backdrop-blur-sm rounded-full hover:bg-amber-500/20 hover:text-amber-100 hover:border-amber-500/60 transition-all duration-300 border border-amber-500/20 hover:-translate-y-0.5 whitespace-nowrap shadow-sm">
                  E-commerce
                </button>
                <button onClick={() => setPrompt("Build a dashboard with charts and data visualization")} className="px-5 py-2.5 text-sm text-amber-200/80 bg-black/40 backdrop-blur-sm rounded-full hover:bg-amber-500/20 hover:text-amber-100 hover:border-amber-500/60 transition-all duration-300 border border-amber-500/20 hover:-translate-y-0.5 whitespace-nowrap shadow-sm">
                  Dashboard
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes blob {
          0% { transform: translate(0px, 0px) scale(1) rotate(0deg); }
          33% { transform: translate(30px, -50px) scale(1.1) rotate(10deg); }
          66% { transform: translate(-20px, 20px) scale(0.9) rotate(-10deg); }
          100% { transform: translate(0px, 0px) scale(1) rotate(0deg); }
        }
        @keyframes pulse-slow {
          0%, 100% { opacity: 0.8; transform: translate(-50%, -50%) scale(1); }
          50% { opacity: 1; transform: translate(-50%, -50%) scale(1.05); }
        }
        .animate-blob {
          animation: blob 10s infinite alternate ease-in-out;
        }
        .animate-pulse-slow {
          animation: pulse-slow 8s infinite alternate ease-in-out;
        }
        .animation-delay-2000 {
          animation-delay: 2s;
        }
      `}</style>
    </main>
  );
}
