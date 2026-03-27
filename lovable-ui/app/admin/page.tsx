import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Navbar from "@/components/Navbar";
import { revalidatePath } from "next/cache";

export default async function AdminPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Double check admin role
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    redirect("/dashboard");
  }

  // Fetch all users
  const { data: users, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });

  // Update credits action
  async function updateCredits(formData: FormData) {
    "use server";
    const userId = formData.get("userId") as string;
    const newCredits = parseInt(formData.get("credits") as string);

    if (!userId || isNaN(newCredits)) return;

    const supabaseAdmin = createClient();
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ credits: newCredits })
      .eq("id", userId);

    if (!error) {
      revalidatePath("/admin");
    }
  }

  // Make user admin action
  async function makeAdmin(formData: FormData) {
    "use server";
    const userId = formData.get("userId") as string;

    if (!userId) return;

    const supabaseAdmin = createClient();
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", userId);

    if (!error) {
      revalidatePath("/admin");
    }
  }

  return (
    <main className="min-h-screen bg-black text-white relative">
      <Navbar />

      <div className="pt-24 px-6 md:px-12 max-w-7xl mx-auto pb-12">
        <div className="mb-12">
          <h1 className="text-3xl font-bold mb-2">Admin Dashboard</h1>
          <p className="text-gray-400">Manage users and their credit balances.</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-400">
              <thead className="text-xs text-gray-400 uppercase bg-gray-800">
                <tr>
                  <th scope="col" className="px-6 py-4">User Email</th>
                  <th scope="col" className="px-6 py-4">Role</th>
                  <th scope="col" className="px-6 py-4">Credits</th>
                  <th scope="col" className="px-6 py-4">Joined At</th>
                  <th scope="col" className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users?.map((u) => (
                  <tr key={u.id} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                    <td className="px-6 py-4 font-medium text-white whitespace-nowrap">
                      {u.email}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                        u.role === 'admin' ? 'bg-purple-500/20 text-purple-400' : 'bg-gray-700 text-gray-300'
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {u.credits}
                    </td>
                    <td className="px-6 py-4">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-3">
                        <form action={updateCredits} className="flex gap-2">
                          <input type="hidden" name="userId" value={u.id} />
                          <input
                            type="number"
                            name="credits"
                            defaultValue={u.credits}
                            className="w-20 px-2 py-1 bg-black border border-gray-700 rounded text-white focus:outline-none focus:border-blue-500"
                          />
                          <button
                            type="submit"
                            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                          >
                            Save
                          </button>
                        </form>
                        {u.role !== 'admin' && (
                          <form action={makeAdmin}>
                            <input type="hidden" name="userId" value={u.id} />
                            <button
                              type="submit"
                              className="px-3 py-1 bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 border border-purple-500/30 rounded transition-colors"
                              title="Make Admin"
                            >
                              Elevate
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {(!users || users.length === 0) && (
              <div className="text-center py-12 text-gray-500">
                No users found.
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
