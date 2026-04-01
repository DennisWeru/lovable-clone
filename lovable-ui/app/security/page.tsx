import Navbar from "@/components/Navbar";
import Link from "next/link";

export default function SecurityPage() {
  const sections = [
    {
      title: "Your data is yours.",
      description: "We don't use your private generations or codebases to train our models without your explicit permission. Your intellectual property stays in your swarm."
    },
    {
      title: "Environment Isolation",
      description: "Every build happens in a secure, isolated sandbox provided by our infrastructure partners. No cross-contaminations, no leaks."
    },
    {
      title: "SOC2 Compliance",
      description: "We are actively pursuing SOC2 Type II compliance to ensure we meet the highest standards of data security and organizational integrity."
    }
  ];

  return (
    <main className="min-h-screen relative overflow-hidden bg-black selection:bg-amber-500/30">
      <Navbar />

      <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] bg-amber-500/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-yellow-500/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center pt-32 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-left">
          <div className="mb-6 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold tracking-wider uppercase">
            Security & Trust
          </div>

          <h1 className="text-5xl sm:text-7xl font-extrabold text-transparent bg-clip-text bg-gradient-to-b from-white via-amber-100 to-amber-500 mb-6 tracking-tight text-center md:text-left">
            Safety in the Swarm.
          </h1>

          <p className="text-xl text-amber-100/70 mb-20 font-light leading-relaxed max-w-2xl text-center md:text-left">
            Security isn&apos;t an afterthought at Lovabee. It&apos;s woven into every line of code we generate and every sandbox we spin up.
          </p>

          <div className="space-y-12 mb-24">
            {sections.map((section) => (
              <div key={section.title} className="p-10 rounded-[2.5rem] bg-[#0a0a0a] border border-gray-800 hover:border-amber-500/30 transition-all duration-500">
                <h3 className="text-3xl font-bold text-white mb-4">{section.title}</h3>
                <p className="text-gray-400 text-lg leading-relaxed">
                  {section.description}
                </p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="p-8 rounded-3xl bg-gray-900/50 border border-gray-800">
              <h4 className="text-white font-bold mb-2">Penetration Testing</h4>
              <p className="text-gray-500 text-sm">We conduct regular ethical hacking sessions to find and remediate vulnerabilities in the core engine.</p>
            </div>
            <div className="p-8 rounded-3xl bg-gray-900/50 border border-gray-800">
              <h4 className="text-white font-bold mb-2">Data Privacy</h4>
              <p className="text-gray-500 text-sm">Strict adherence to GDPR and CCPA guidelines to protect our global community.</p>
            </div>
          </div>

          <div className="mt-32 text-center p-16 rounded-[3rem] bg-amber-500/5 border border-amber-500/10">
            <h2 className="text-3xl font-bold text-white mb-6">Security Questions?</h2>
            <p className="text-gray-400 mb-10 max-w-md mx-auto">Our security team is ready to provide specific documentation for your technical due diligence.</p>
            <a href="mailto:security@lovabee.vercel.app" className="inline-block px-10 py-4 bg-amber-600 text-black font-extrabold rounded-2xl transition-all">
              Contact Security Team
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
