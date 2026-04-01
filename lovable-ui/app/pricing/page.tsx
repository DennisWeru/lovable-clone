import Navbar from "@/components/Navbar";
import Link from "next/link";

export default function PricingPage() {
  const plans = [
    {
      name: "Free",
      price: "$0",
      description: "For hobbyists and curious builders exploring the potential of AI.",
      features: [
        "Include Lovabee branding",
        "Public generations only",
        "Community support",
        "Standard generation speed",
        "5 projects limit"
      ],
      cta: "Get started",
      featured: false
    },
    {
      name: "Pro",
      price: "$20",
      description: "For individual developers and creators shipping production apps.",
      features: [
        "Remove Lovabee branding",
        "Private generations",
        "Priority generation queue",
        "Custom domain support",
        "Unlimited projects",
        "Advanced editing tools"
      ],
      cta: "Go Pro",
      featured: true
    },
    {
      name: "Team",
      price: "$60",
      description: "For small teams and startups collaborating on a single hive.",
      features: [
        "Everything in Pro",
        "Shared team workspace",
        "Collaborative editing",
        "Team-wide project sharing",
        "Unified billing",
        "Advanced security controls"
      ],
      cta: "Join the Hive",
      featured: false
    }
  ];

  return (
    <main className="min-h-screen relative overflow-hidden bg-black selection:bg-amber-500/30">
      <Navbar />

      {/* Honeycomb ambient glows */}
      <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] bg-amber-500/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-yellow-500/5 rounded-full blur-[100px] pointer-events-none" />

      {/* Hero section */}
      <div className="relative z-10 flex flex-col items-center justify-center pt-32 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <div className="mb-6 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold tracking-wider">
            TRANSPARENT PRICING
          </div>

          <h1 className="text-5xl sm:text-7xl font-extrabold text-transparent bg-clip-text bg-gradient-to-b from-white via-amber-100 to-amber-500 mb-6 tracking-tight">
            Plans for every stage of your swarm.
          </h1>

          <p className="text-xl text-amber-100/70 mb-16 max-w-2xl mx-auto font-light">
            Start for free and upgrade as you scale your productivity. No hidden fees, just simple pricing for incredible velocity.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-20 text-left">
            {plans.map((plan) => (
              <div 
                key={plan.name} 
                className={`relative p-8 rounded-[2rem] border transition-all duration-500 group ${
                  plan.featured 
                    ? "bg-[#0a0a0a] border-amber-500 shadow-[0_0_50px_rgba(245,158,11,0.15)] ring-1 ring-amber-500/50" 
                    : "bg-gray-900/30 border-gray-800 hover:border-gray-700"
                }`}
              >
                {plan.featured && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-amber-500 text-black text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest shadow-lg">
                    Most Popular
                  </div>
                )}
                
                <h3 className="text-2xl font-bold text-white mb-2">{plan.name}</h3>
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-4xl font-extrabold text-white">{plan.price}</span>
                  <span className="text-gray-500 text-sm">/month</span>
                </div>
                <p className="text-gray-400 text-sm mb-8 leading-relaxed">
                  {plan.description}
                </p>

                <ul className="space-y-4 mb-10">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-3 text-sm text-gray-300">
                      <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>

                <button 
                  className={`w-full py-4 rounded-2xl font-bold transition-all ${
                    plan.featured 
                      ? "bg-amber-500 text-black hover:bg-amber-400 shadow-lg shadow-amber-500/20" 
                      : "bg-white/5 text-white border border-white/10 hover:bg-white/10"
                  }`}
                >
                  {plan.cta}
                </button>
              </div>
            ))}
          </div>

          <div className="p-10 rounded-[2.5rem] bg-gradient-to-br from-amber-500/10 to-transparent border border-amber-500/20 text-left flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="flex-1">
              <h3 className="text-3xl font-bold text-white mb-2">Enterprise</h3>
              <p className="text-amber-100/60 max-w-xl">
                Need specialized security, dedicated models, or custom integrations for your large engineering organization? Our Enterprise team is ready to help you scale.
              </p>
            </div>
            <a href="mailto:sales@lovabee.vercel.app" className="px-10 py-4 bg-transparent border-2 border-amber-500 text-amber-500 hover:bg-amber-500/10 font-bold rounded-2xl transition-colors whitespace-nowrap">
              Contact Sales
            </a>
          </div>

          <p className="mt-20 text-gray-500 text-sm">
            All plans include access to our basic model. Pro and Team access our most powerful agentic hive minds.
          </p>
        </div>
      </div>
    </main>
  );
}
