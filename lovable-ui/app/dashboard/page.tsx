import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Navbar from "@/components/Navbar";
import Link from "next/link";

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const supabaseAdmin = createAdminClient();

  // Fetch user profile (for credits and role)
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("credits, role")
    .eq("id", user.id)
    .single();

  // Fetch user projects
  const { data: projects, error } = await supabaseAdmin
    .from("projects")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <main className="min-h-screen bg-black text-white relative">
      <Navbar />

      <div className="pt-24 px-6 md:px-12 max-w-7xl mx-auto pb-12">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
          <div>
            <h1 className="text-3xl font-bold mb-2">My Dashboard</h1>
            <p className="text-gray-400">Manage your generated projects and credits.</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-3 flex flex-col items-center">
              <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-1">Credits</span>
              <span className="text-2xl font-bold text-blue-400">{profile?.credits ?? 0}</span>
            </div>
            {profile?.role === "admin" && (
              <Link
                href="/admin"
                className="bg-purple-600/20 text-purple-400 border border-purple-500/30 px-5 py-3 rounded-xl font-medium hover:bg-purple-600/30 transition-colors h-full flex items-center justify-center"
              >
                Admin Panel
              </Link>
            )}
            <Link
              href="/"
              className="bg-white text-black px-5 py-3 rounded-xl font-medium hover:bg-gray-200 transition-colors h-full flex items-center justify-center"
            >
              New Project
            </Link>
          </div>
        </div>

        <h2 className="text-xl font-semibold mb-6 pb-2 border-b border-gray-800">Your Projects</h2>

        {!projects || projects.length === 0 ? (
          <div className="text-center py-20 bg-gray-900/50 border border-gray-800 rounded-2xl">
            <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-300 mb-2">No projects yet</h3>
            <p className="text-gray-500 max-w-sm mx-auto mb-6">You haven&apos;t generated any projects yet. Start by entering a prompt on the home page.</p>
            <Link href="/" className="text-blue-400 hover:text-blue-300 font-medium">
              Generate your first project &rarr;
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => {
              const openParams = new URLSearchParams({
                prompt: project.prompt,
                model: project.model,
                projectId: project.id,
                ...(project.sandbox_id ? { sandboxId: project.sandbox_id } : {}),
                ...(project.preview_url ? { previewUrl: project.preview_url } : {}),
              }).toString();

              const isFailed = project.status === "failed";
              const hasSandbox = !!project.sandbox_id;

              const primaryLabel = isFailed
                ? "↺ Retry"
                : hasSandbox
                ? "✏️ Continue"
                : "📂 View";

              const primaryClass = isFailed
                ? "flex-1 py-2 text-center text-sm font-medium bg-red-500/10 hover:bg-red-500/20 text-red-300 rounded-lg transition-colors border border-red-500/20"
                : "flex-1 py-2 text-center text-sm font-medium bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors border border-white/10";

              return (
                <div key={project.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden flex flex-col group hover:border-gray-700 transition-colors">
                  <div className="p-6 flex-1">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-xs font-medium px-2.5 py-1 bg-gray-800 text-gray-300 rounded-md">
                        {new Date(project.created_at).toLocaleDateString()}
                      </span>
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-md ${
                        project.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                        project.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                        'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {project.status.charAt(0).toUpperCase() + project.status.slice(1)}
                      </span>
                    </div>
                    <h3 className="text-sm font-medium text-white mb-2 line-clamp-2" title={project.prompt}>
                      &quot;{project.prompt}&quot;
                    </h3>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-500">Model: {project.model}</p>
                      {project.credits_used > 0 && (
                        <span className="text-[10px] font-semibold text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20">
                          {project.credits_used.toLocaleString()} Credits Used
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-gray-800 p-4 bg-gray-900/50 flex gap-3">
                    {/* Primary action — always present for every project */}
                    <Link href={`/generate?${openParams}`} className={primaryClass}>
                      {primaryLabel}
                    </Link>

                    {/* Preview link — only when a URL is available */}
                    {project.preview_url && (
                      <a
                        href={project.preview_url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 py-2 text-center text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                      >
                        View Preview
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
