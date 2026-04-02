import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { Octokit } from "octokit";

export const maxDuration = 60; // Allow it time to push

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { projectId, sandboxId, githubToken, repoName, description, isPrivate = false } = body;

    if (!projectId || !sandboxId || !githubToken || !repoName) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
    }

    // 1. Initialize Clients
    const { Daytona } = await import("@daytonaio/sdk");
    const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
    const octokit = new Octokit({ auth: githubToken });
    const supabase = createAdminClient();

    // 2. Locate Sandbox
    const response = await daytona.list();
    const sandbox = response.items.find((s: any) => s.id === sandboxId);
    if (!sandbox) {
      return NextResponse.json({ error: "Sandbox not found" }, { status: 404 });
    }

    // 3. GitHub: Get User and Create/Get Repo
    let owner;
    try {
      const { data: user } = await octokit.rest.users.getAuthenticated();
      owner = user.login;
      console.log(`[Export API] GitHub User authenticated: ${owner}`);
    } catch (e: any) {
      return NextResponse.json({ error: `GitHub Authentication failed: ${e.message}` }, { status: 401 });
    }

    // Check if repo exists
    let repoUrl = "";
    try {
      const { data: repo } = await octokit.rest.repos.get({ owner, repo: repoName });
      repoUrl = repo.clone_url;
      console.log(`[Export API] Repository already exists: ${repoUrl}`);
    } catch (e: any) {
      if (e.status === 404) {
        console.log(`[Export API] Creating repository: ${repoName}`);
        const { data: newRepo } = await octokit.rest.repos.createForAuthenticatedUser({
          name: repoName,
          description: description || "Automatically generated with Lovabee",
          private: isPrivate,
          auto_init: false,
        });
        repoUrl = newRepo.clone_url;
        console.log(`[Export API] Repository created: ${repoUrl}`);
      } else {
        throw e;
      }
    }

    // 4. Executing Git Push in Sandbox
    // Construct the authenticated remote URL
    const authenticatedUrl = repoUrl.replace("https://", `https://${githubToken}@`);

    const projectDir = "/home/daytona/website-project"; // Same as in generation worker
    const setupScript = [
      `cd ${projectDir}`,
      `ls -la`,
      `git init`,
      `git config user.name "Lovabee Agent"`,
      `git config user.email "agent@lovabee.vercel.app"`,
      `git status`,
      `git add .`,
      `git commit -m "Exported from Lovabee" --allow-empty`,
      `git branch -M main`,
      `git remote add origin "${authenticatedUrl}" || git remote set-url origin "${authenticatedUrl}"`,
      `git push -u origin main -f`,
    ].join(" && ");

    console.log(`[Export API] Running git push in sandbox: ${sandboxId}`);
    
    // We redirect stderr to stdout (2>&1) to capture the actual error from git
    // We use single quotes for the outer wrapper to avoid clashing with inner double quotes
    const exportResult = await sandbox.process.executeCommand(
      `/bin/bash -c '( ${setupScript.replace(/'/g, "'\\''")} ) 2>&1 && echo "EXPORT_SUCCESS" || echo "EXPORT_FAILED"'`
    );

    const fullOutput = exportResult.result || "";
    if (!fullOutput.includes("EXPORT_SUCCESS")) {
      console.error("[Export API] Git push failed:", fullOutput);
      return NextResponse.json({ 
        error: "Git push failed", 
        output: fullOutput
      }, { status: 500 });
    }

    console.log("[Export API] Export successful!");
    
    // Save repo info in projects table
    await supabase
      .from("projects")
      .update({ 
        github_repo: `${owner}/${repoName}`,
        github_url: `https://github.com/${owner}/${repoName}`
      })
      .eq("id", projectId);

    return NextResponse.json({ 
      success: true, 
      repoUrl: `https://github.com/${owner}/${repoName}` 
    });

  } catch (err: any) {
    console.error("[Export API] Fatal Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
