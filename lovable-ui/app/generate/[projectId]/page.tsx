"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import { createClient } from "@/lib/supabase/client";
import { Suspense } from "react";

interface Message {
  id?: string;
  type: "user" | "claude_message" | "tool_use" | "tool_result" | "progress" | "error" | "complete";
  content?: string;
  name?: string;
  input?: any;
  result?: any;
  message?: string;
  code?: string;
  previewUrl?: string;
  sandboxId?: string;
  metadata?: any;
  isHistory?: boolean;
}

function GenerateContent({ projectId }: { projectId: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const prompt = searchParams.get("prompt") || "";
  const model = searchParams.get("model") || "google/gemini-3.1-flash-lite-preview";
  const initialSandboxId = searchParams.get("sandboxId");
  const initialPreviewUrl = searchParams.get("previewUrl");
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialPreviewUrl);
  const [sandboxId, setSandboxId] = useState<string | null>(initialSandboxId);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [lastPrompt, setLastPrompt] = useState<string>(prompt);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasStartedRef = useRef(false);
  const loadingStuckTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [showLogsAction, setShowLogsAction] = useState(false);
  const [regenCount, setRegenCount] = useState(0);
  const [logs, setLogs] = useState<string>("");
  const [showConsole, setShowConsole] = useState(false);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const seenMessageIds = useRef<Set<string>>(new Set());
  const [realtimeError, setRealtimeError] = useState(false);

  // GitHub Export State
  const [showExportModal, setShowExportModal] = useState(false);
  const [githubToken, setGithubToken] = useState("");
  const [repoName, setRepoName] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportUrl, setExportUrl] = useState<string | null>(null);

  // Load github token from storage on mount
  useEffect(() => {
    const savedToken = localStorage.getItem("github_token");
    if (savedToken) setGithubToken(savedToken);
    
    // Default repo name from prompt
    if (prompt) {
      setRepoName(prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50));
    }
  }, [prompt]);
  
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (showConsole) {
      consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, showConsole]);

  // Log Polling
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isGenerating && sandboxId) {
      const pollLogs = async () => {
        try {
          const res = await fetch(`/api/daytona-logs?sandboxId=${sandboxId}`);
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.logs) {
              setLogs(data.logs);
            }
          }
        } catch (e) {
          console.error("Failed to poll logs", e);
        }
      };
      
      pollLogs(); // Initial
      interval = setInterval(pollLogs, 3000); // Every 3s
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isGenerating, sandboxId]);
  
  // Message Polling Fallback
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isGenerating && projectId) {
      const pollMessages = async () => {
        try {
          const res = await fetch(`/api/project-messages?projectId=${projectId}`);
          if (res.ok) {
            const { messages: fetchedMsgs } = await res.json();
            if (fetchedMsgs && fetchedMsgs.length > 0) {
              const newMsgs: Message[] = [];
              fetchedMsgs.forEach((m: any) => {
                if (!seenMessageIds.current.has(m.id)) {
                  seenMessageIds.current.add(m.id);
                  const msg: Message = {
                    id: m.id,
                    type: m.type,
                    content: m.content ?? undefined,
                    message: m.content ?? undefined,
                    name: m.metadata?.name,
                    input: m.metadata?.input,
                    previewUrl: m.metadata?.previewUrl,
                    sandboxId: m.metadata?.sandboxId,
                  };
                  newMsgs.push(msg);
                }
              });

              if (newMsgs.length > 0) {
                setMessages((prev) => [...prev, ...newMsgs]);
                
                // Track if we got 'complete' or 'error' in polling
                newMsgs.forEach(m => {
                  if (m.type === "error" || m.type === "complete") {
                    if (m.type === "complete") {
                      if (m.previewUrl) setPreviewUrl(m.previewUrl);
                      if (m.sandboxId) setSandboxId(m.sandboxId);
                      setRegenCount((prev) => prev + 1);
                    }
                    setIsGenerating(false);
                    if (loadingStuckTimerRef.current) clearTimeout(loadingStuckTimerRef.current);
                  }
                });
              }
            }
          }
        } catch (e) {
          console.error("Failed to poll messages", e);
        }
      };
      
      interval = setInterval(pollMessages, 5000); // Check every 5s
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isGenerating, projectId]);
  
  useEffect(() => {
    if (!projectId && !prompt && !initialSandboxId) {
      router.push("/");
      return;
    }
    
    // Prevent double execution in StrictMode
    if (hasStartedRef.current) {
      return;
    }
    hasStartedRef.current = true;
    
    const init = async () => {
      setLastPrompt(prompt);
      // Load history first if we have a projectId (continuing a project)
      if (projectId) {
        setIsLoadingHistory(true);
        try {
          const res = await fetch(`/api/project-messages?projectId=${projectId}`);
          if (res.ok) {
            const { messages: historyMsgs } = await res.json();
            if (historyMsgs && historyMsgs.length > 0) {
              const formattedHistory = historyMsgs.map((m: any) => {
                seenMessageIds.current.add(m.id);
                return {
                  id: m.id,
                  type: m.type,
                  content: m.content ?? undefined,
                  name: m.metadata?.name,
                  input: m.metadata?.input,
                  isHistory: true,
                };
              });
              setMessages(formattedHistory);
            }
          }
        } catch (e) {
          console.error("Failed to load history", e);
        } finally {
          setIsLoadingHistory(false);
        }
      }

      // Only auto-generate if we have a prompt and NO preview URL yet
      if (prompt && !initialPreviewUrl) {
        setIsGenerating(true);
        generateWebsite(prompt);
      }
    };

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, router, initialSandboxId, initialPreviewUrl, projectId]);
  
  const generateWebsite = async (currentPrompt: string) => {
    console.log("[Generate] Starting generation for prompt:", currentPrompt);
    try {
      setLastPrompt(currentPrompt);
      setError(null);
      setIsGenerating(true);
      setShowLogsAction(false);
      setShowConsole(true);
      setLogs("Initializing background agent...\n");
      
      if (loadingStuckTimerRef.current) clearTimeout(loadingStuckTimerRef.current);
      loadingStuckTimerRef.current = setTimeout(() => {
        setIsGenerating(false);
        setError({
          message: "The generation worker did not report completion in time. This might be due to a slow AI response or large dependency install.",
          code: "WORKER_STALLED"
        });
        setShowLogsAction(true);
      }, 300000);

      console.log("[Generate] Calling API /api/generate-daytona...");
      const response = await fetch("/api/generate-daytona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          prompt: currentPrompt, 
          model, 
          sandboxId: sandboxId,
          projectId: projectId,
        }),
      });

      console.log("[Generate] API Response status:", response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Server returned error (non-JSON)" }));
        console.error("[Generate] API error data:", errorData);
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const data = await response.json();
      console.log("[Generate] API success data:", data);
      const currentProjectId = data.projectId;
      if (data.sandboxId) setSandboxId(data.sandboxId);
      if (data.previewUrl) setPreviewUrl(data.previewUrl);

      // Start Realtime Subscription
      console.log("[Generate] Initializing Supabase Realtime for Project:", currentProjectId);
      const supabase = createClient();
      const channel = supabase
        .channel(`project-progress-${currentProjectId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "project_messages",
            filter: `project_id=eq.${currentProjectId}`,
          },
          (payload) => {
            console.log("[Generate] Realtime Event Received:", payload);
            const newMessage = payload.new as any;
            
            // Deduplicate
            if (seenMessageIds.current.has(newMessage.id)) {
              console.log("[Generate] Duplicate message ignored:", newMessage.id);
              return;
            }
            seenMessageIds.current.add(newMessage.id);

            const message: Message = {
              id: newMessage.id,
              type: newMessage.type,
              content: newMessage.content ?? undefined,
              message: newMessage.content ?? undefined,
              name: newMessage.metadata?.name,
              input: newMessage.metadata?.input,
              previewUrl: newMessage.metadata?.previewUrl,
              sandboxId: newMessage.metadata?.sandboxId,
            };
            
            if (loadingStuckTimerRef.current) clearTimeout(loadingStuckTimerRef.current);

            if (message.type === "error") {
              setError({ message: message.content || "An error occurred" });
              setIsGenerating(false);
            } else if (message.type === "complete") {
              if (message.previewUrl) setPreviewUrl(message.previewUrl);
              if (message.sandboxId) setSandboxId(message.sandboxId);
              setRegenCount((prev) => prev + 1); // Force iframe refresh
              setIsGenerating(false);
              channel.unsubscribe();
            } else {
              setMessages((prev) => [...prev, message]);
            }
          }
        )
        .subscribe((status) => {
          console.log(`[Generate] Realtime Subscription Status for ${currentProjectId}:`, status);
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            setRealtimeError(true);
            // DO NOT stop generation - let polling fallback take over
            console.warn("[Generate] Realtime degraded, falling back to polling...");
          } else if (status === "SUBSCRIBED") {
            setRealtimeError(false);
          }
        });

    } catch (err: any) {
      if (loadingStuckTimerRef.current) clearTimeout(loadingStuckTimerRef.current);
      console.error("Error generating website:", err);
      setError({ message: err.message || "An error occurred" });
      setIsGenerating(false);
    }
  };

  const fetchWorkerLogs = async () => {
    if (!sandboxId) return;
    try {
      const res = await fetch(`/api/daytona-logs?sandboxId=${sandboxId}`);
      const data = await res.json();
      if (data.success) {
        setLogs(data.logs);
        setShowConsole(true);
      } else {
        alert("Failed to fetch logs: " + data.error);
      }
    } catch (e: any) {
      alert("Error fetching logs: " + e.message);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isGenerating) return;

    const userMessage = inputValue;
    setInputValue("");
    generateWebsite(userMessage);
  };

  const handleRestartServer = async () => {
    if (!sandboxId || isGenerating) return;

    try {
      setError(null);
      setIsGenerating(true);
      setMessages((prev) => [...prev, { type: "progress", message: "Restarting development server..." }]);

      const response = await fetch("/api/restart-server", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId, projectId }),
      });

      if (!response.ok) {
        let errorData;
        try {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            errorData = await response.json();
          } else {
            const textResponse = await response.text();
            throw new Error(`Server returned unexpected format (HTTP ${response.status}).`);
          }
        } catch (e: any) {
          throw new Error(errorData?.error || e.message || "Failed to restart server");
        }
        throw new Error(errorData.error || "Failed to restart server");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No response body");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") break;

            try {
              const message = JSON.parse(data) as Message;
              if (message.type === "error") {
                setError({
                  message: message.message || "An error occurred",
                  code: message.code
                });
              } else if (message.type === "complete") {
                setPreviewUrl(message.previewUrl || null);
              } else {
                setMessages((prev) => [...prev, message]);
              }
            } catch (e) {}
          }
        }
      }
    } catch (err: any) {
      setError({ message: err.message || "An error occurred" });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExportGithub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sandboxId || !githubToken || !repoName || isExporting) return;

    try {
      setIsExporting(true);
      setExportError(null);
      setExportUrl(null);

      localStorage.setItem("github_token", githubToken);

      const response = await fetch("/api/export-github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          sandboxId,
          githubToken,
          repoName,
          description: `Automatically generated from prompt: ${prompt}`,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Export failed");

      setExportUrl(data.repoUrl);
    } catch (err: any) {
      setExportError(err.message);
    } finally {
      setIsExporting(false);
    }
  };

  const getFriendlyError = (error: { message: string; code?: string }) => {
    if (error.code === "SANDBOX_NOT_FOUND" && sandboxId) {
      setSandboxId(null);
    }

    switch (error.code) {
      case "SANDBOX_NOT_FOUND":
        return {
          title: "Sandbox session lost",
          description: "We couldn't find your sandbox. This might happen if it was inactive for too long.",
          action: "Try starting over by clicking Retry.",
          canRetry: true,
        };
      case "SANDBOX_CREATION_FAILED":
        return {
          title: "Failed to create sandbox",
          description: "There was an issue spinning up your environment. This might be a temporary service outage.",
          action: "Please try again in a moment.",
          canRetry: true,
        };
      case "NPM_INSTALL_FAILED":
        return {
          title: "Installation issue",
          description: "We had some trouble installing the necessary packages for your app.",
          action: "You can try to Retry the process.",
          canRetry: true,
        };
      case "AI_PARSE_ERROR":
        return {
          title: "AI Response Glitch",
          description: "The AI gave us a response we didn't quite understand. It happens sometimes with complex requests!",
          action: "Try hitting Retry to let it try again.",
          canRetry: true,
        };
      case "QUOTA_EXCEEDED":
        return {
          title: "API Quota Exceeded",
          description: "We've hit the Gemini API rate limits. The agent tried to retry automatically but finally gave up.",
          action: "Please wait a few minutes before trying again to allow the quota to reset.",
          canRetry: true,
        };
      case "WORKER_STALLED":
        return {
          title: "Worker Silent Failure",
          description: "The background process did not report any progress. It may have crashed silently.",
          action: "Fetch the logs or Retry.",
          canRetry: true,
        };
      case "SERVER_START_TIMEOUT":
        return {
          title: "Server taking its time",
          description: "Your app is being generated, but the preview server is taking longer than usual to start.",
          action: "You can wait another minute or try to manually restart the server.",
          canRestart: true,
        };
      case "MISSING_API_KEY":
        return {
          title: "Configuration Error",
          description: "One of the required API keys is missing from our server configuration.",
          action: "Please check your .env file or contact the administrator.",
        };
      default:
        return {
          title: "Something went wrong",
          description: error.message,
          action: "Try hitting Retry or check your request.",
          canRetry: true,
        };
    }
  };
  
  const getFriendlyToolMessage = (name: string, input: any) => {
    switch (name) {
      case "list_files":
      case "list_dir":
      case "ListFilesAction":
      case "ExploreWorkspaceAction":
        return `Analyzing project structure...`;
      case "read_file":
      case "FileReadAction":
        return `Reviewing code in ${input.path || input.file_path || "file"}...`;
      case "write_file":
      case "FileEditAction":
      case "FileWriteAction":
        const file = input.path || input.file_path || "";
        if (file.endsWith(".html")) return `Drafting webpage layout (${file})...`;
        if (file.endsWith(".css")) return `Adding styles and themes (${file})...`;
        if (file.endsWith(".js") || file.endsWith(".ts") || file.endsWith(".tsx")) return `Implementing logic in ${file}...`;
        return `Creating ${file}...`;
      case "run_command":
      case "CmdRunAction":
      case "ShellAction":
        const cmd = input.command || input.cmd || "";
        if (cmd.includes("npm install")) return `Installing project dependencies...`;
        if (cmd.includes("npm run") || cmd.includes("node ")) return `Booting up your application...`;
        if (cmd.includes("mkdir")) return `Setting up project folders...`;
        return `Running system task: ${cmd.split(' ')[0]}...`;
      case "search_docs":
      case "SearchDocsAction":
        return `Researching ${input.project || 'libraries'} documentation...`;
      case "take_screenshot":
      case "ScreenshotAction":
        return `Taking a snapshot to verify the design...`;
      default:
        // If it's a generic progress message, return it as is
        if (name === "progress") return input.message;
        return `Performing agent task: ${name}...`;
    }
  };

  const getToolIcon = (name: string) => {
    switch (name) {
      case "write_file": return "📝";
      case "run_command": return "⚙️";
      case "read_file": return "🔍";
      case "search_docs": return "📚";
      case "take_screenshot": return "📸";
      case "list_files": return "📁";
      default: return "🔧";
    }
  };

  const formatToolInput = (input: any) => {
    if (!input) return "";
    if (input.file_path || input.path) {
      return input.file_path || input.path;
    } else if (input.command) {
      return input.command;
    } else if (input.project) {
      return `${input.vendor}/${input.project}`;
    }
    return "";
  };

  return (
    <main className="h-screen bg-black flex flex-col overflow-hidden relative">
      <Navbar />
      <div className="h-16" />
      
      <div className="flex-1 flex overflow-hidden">
        <div className="w-[30%] flex flex-col border-r border-gray-800">
          <div className="p-4 border-b border-gray-800 flex items-center justify-between">
            <div>
              <h2 className="text-white font-semibold flex items-center gap-2">
                Lovabee
                {isGenerating && (
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                )}
              </h2>
              <p className="text-gray-400 text-xs mt-1 truncate max-w-[200px]">{prompt}</p>
            </div>
            <button 
              onClick={() => setShowConsole(!showConsole)}
              className={`p-1.5 rounded-md border transition-colors ${showConsole ? 'bg-amber-600/20 border-amber-500/50 text-amber-400' : 'border-gray-800 text-gray-400 hover:text-gray-300'}`}
              title="Toggle Agent Console"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4 overflow-x-hidden">
            {isLoadingHistory && (
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-500" />
                Loading conversation history...
              </div>
            )}

            {messages.map((message, index) => (
              <div key={index}>
                {!message.isHistory && index > 0 && messages[index - 1].isHistory && (
                  <div className="flex items-center gap-2 py-2">
                    <div className="flex-1 h-px bg-gray-800" />
                    <span className="text-xs text-gray-600 px-2">New session</span>
                    <div className="flex-1 h-px bg-gray-800" />
                  </div>
                )}

                {message.type === "user" && (
                  <div className="flex justify-end">
                    <div className="bg-amber-600/20 border border-amber-500/30 rounded-lg p-3 max-w-[85%]">
                      <p className="text-amber-100 text-sm whitespace-pre-wrap break-words">{message.content}</p>
                    </div>
                  </div>
                )}

                {message.type === "claude_message" && (
                  <div className="bg-gray-900 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 bg-amber-500 rounded-full flex items-center justify-center">
                        <span className="text-black font-bold text-xs">B</span>
                      </div>
                      <span className="text-white font-medium">Lovabee</span>
                      {message.isHistory && (
                        <span className="text-xs text-gray-600 ml-auto">history</span>
                      )}
                    </div>
                    <p className="text-gray-300 whitespace-pre-wrap break-words">{message.content}</p>
                  </div>
                )}
                
                {message.type === "tool_use" && (
                  <div className="flex items-start gap-3 group">
                    <div className="w-8 h-8 rounded-full bg-amber-600/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-sm">{getToolIcon(message.name || "")}</span>
                    </div>
                    <div className="flex-1 space-y-1">
                      <p className="text-gray-300 text-sm font-medium leading-tight">
                        {getFriendlyToolMessage(message.name || "", message.input)}
                      </p>
                      <p className="text-gray-500 text-[11px] font-mono truncate max-w-[200px]" title={formatToolInput(message.input)}>
                        {message.name}({formatToolInput(message.input)})
                      </p>
                    </div>
                  </div>
                )}

                {message.type === "tool_result" && (
                  <div className="flex items-center gap-3 py-1 opacity-60">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500/50 ml-3.5" />
                    <div className="text-gray-500 text-[10px] font-medium">
                      Tool {message.name} returned {message.content?.length || 0} chars
                    </div>
                  </div>
                )}
                
                {message.type === "progress" && (
                  <div className="flex items-center gap-3 py-1">
                    <div className="w-2 h-2 rounded-full bg-amber-500/50 animate-pulse ml-3" />
                    <div className="text-gray-400 text-xs font-medium italic">
                      {message.content === "Agent active with tools..." ? "Developing your website..." : (message.content || message.message)}
                    </div>
                  </div>
                )}
              </div>
            ))}
            
            {isGenerating && (
              <div className="flex items-center gap-3 p-3 bg-amber-600/5 rounded-lg border border-amber-500/10 animate-in fade-in slide-in-from-bottom-2 duration-500">
                <div className="relative">
                  <div className="w-5 h-5 rounded-full border-2 border-amber-500/20" />
                  <div className="absolute inset-0 w-5 h-5 rounded-full border-2 border-t-amber-500 animate-spin" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-amber-400 text-xs font-semibold uppercase tracking-wider mb-0.5 flex items-center gap-2">
                    Current Activity
                    {realtimeError && (
                      <span className="flex items-center gap-1 text-[10px] text-gray-500 font-normal lowercase normal-case bg-gray-800 px-1.5 py-0.5 rounded animate-pulse">
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-600" />
                        polling fallback active
                      </span>
                    )}
                  </p>
                  <p className="text-gray-300 text-sm truncate">
                    {(() => {
                      const lastTool = [...messages].reverse().find(m => m.type === "tool_use");
                      const lastProgress = [...messages].reverse().find(m => m.type === "progress");
                      const toolIndex = messages.lastIndexOf(lastTool!);
                      const progressIndex = messages.lastIndexOf(lastProgress!);
                      
                      const genericProgress = ["Agent active with tools...", "Agent active: processing next steps...", "Agent is thinking and executing tasks...", "Developing your website..."];
                      
                      // If we have a very recent progress message (thought), check if it's non-generic
                      if (progressIndex >= 0 && (progressIndex >= toolIndex || (toolIndex - progressIndex) < 3)) {
                         const msg = lastProgress!.content || lastProgress!.message || "";
                         if (msg && !genericProgress.includes(msg)) return msg;
                      }

                      if (toolIndex >= 0) {
                        return getFriendlyToolMessage(lastTool!.name || "", lastTool!.input);
                      } else if (progressIndex >= 0) {
                         const msg = lastProgress!.content || lastProgress!.message || "";
                         if (msg === "Agent active with tools..." || msg === "Agent active: processing next steps...") return "Thinking about next steps...";
                         return msg;
                      }
                      return "Initializing background agent...";
                    })()}
                  </p>
                </div>
              </div>
            )}
            
            {error && (
              <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 space-y-3">
                <div>
                  <h3 className="text-red-400 font-semibold">{getFriendlyError(error).title}</h3>
                  <p className="text-red-300/80 text-sm mt-1">{getFriendlyError(error).description}</p>
                  <p className="text-red-300/60 text-xs mt-2 italic">{getFriendlyError(error).action}</p>
                </div>
                <div className="flex gap-2">
                  {getFriendlyError(error).canRetry && (
                    <button onClick={() => generateWebsite(lastPrompt)} className="px-3 py-1.5 bg-red-600/30 hover:bg-red-600/40 text-red-200 text-xs rounded-md border border-red-500/30 transition-colors">↺ Retry</button>
                  )}
                  {getFriendlyError(error).canRestart && (
                    <button onClick={handleRestartServer} className="px-3 py-1.5 bg-amber-600/30 hover:bg-amber-600/40 text-amber-200 text-xs rounded-md border border-amber-500/30 transition-colors">⚡ Restart Server</button>
                  )}
                  {showLogsAction && (
                    <button onClick={fetchWorkerLogs} className="px-3 py-1.5 bg-yellow-600/30 hover:bg-yellow-600/40 text-yellow-200 text-xs rounded-md border border-yellow-500/30 transition-colors">📄 Fetch Worker Logs</button>
                  )}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          
          <div className="p-4 border-t border-gray-800">
            <form onSubmit={handleSubmit} className="flex items-center gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Ask Lovabee..."
                className="flex-1 px-4 py-2 bg-gray-900 text-white rounded-lg border border-gray-800 focus:outline-none focus:border-gray-700 disabled:opacity-50"
                disabled={isGenerating}
              />
              <button 
                type="submit"
                disabled={isGenerating || !inputValue.trim()}
                className="p-2 text-gray-400 hover:text-gray-300 disabled:opacity-50"
              >
                <svg className="w-5 h-5 transition-transform group-hover:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </form>
          </div>
        </div>
        
        <div className="w-[70%] bg-gray-950 flex flex-col relative">
          {previewUrl && (
            <div className="h-12 bg-gray-900/50 border-b border-gray-800 flex items-center justify-between px-4 z-10 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">Live Preview</span>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => setShowExportModal(true)} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-all flex items-center gap-1.5 text-xs border border-transparent hover:border-gray-700" title="Export code to GitHub repo">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                  </svg>
                  <span>Export to GitHub</span>
                </button>
                <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-all flex items-center gap-1.5 text-xs border border-transparent hover:border-gray-700" title="Open in new tab">
                  <span>Open in browser</span>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            </div>
          )}

          <div className="flex-1 flex items-center justify-center relative overflow-hidden">
            {!previewUrl && isGenerating && (
              <div className="text-center">
                <div className="w-16 h-16 bg-gray-800 rounded-2xl flex items-center justify-center mb-4 mx-auto">
                  <div className="w-12 h-12 bg-gray-700 rounded-xl animate-pulse"></div>
                </div>
                <p className="text-gray-400">Spinning up preview environment...</p>
              </div>
            )}
            
            {previewUrl && (
              <iframe key={`preview-${regenCount}`} src={previewUrl} className="w-full h-full bg-white" title="Website Preview" />
            )}
            
            {!previewUrl && !isGenerating && (
              <div className="text-center">
                <div className="w-16 h-16 border-2 border-gray-800 border-dashed rounded-2xl flex items-center justify-center mb-4 mx-auto opacity-40">
                  <svg className="w-6 h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-gray-400">Preview will appear here</p>
              </div>
            )}
          </div>

          <div className={`absolute bottom-0 left-0 right-0 bg-black/90 border-t border-gray-800 transition-all duration-300 ease-in-out z-20 ${showConsole ? 'h-[250px]' : 'h-0 overflow-hidden border-transparent'}`}>
            <div className="h-full flex flex-col">
              <div className="px-4 py-2 bg-gray-950 border-b border-gray-800 flex items-center justify-between sticky top-0">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="text-xs font-mono text-amber-400 font-bold uppercase tracking-wider">Agent Console Logs</span>
                </div>
                <button onClick={() => setShowConsole(false)} className="text-gray-500 hover:text-white transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] text-gray-300 space-y-1">
                {logs ? logs.split('\n').map((line, i) => (
                  <div key={i} className={`break-words ${line.includes('[Worker]') ? 'text-amber-300' : line.includes('[Tool Call]') ? 'text-amber-300' : line.includes('[Tool Result]') ? 'text-green-400/80' : line.includes('[Thought]') ? 'text-amber-200/90 italic' : line.includes('[Usage]') ? 'text-slate-500 text-[10px]' : line.includes('error') || line.includes('Fatal') ? 'text-red-400 font-bold' : 'text-gray-400'}`}>{line}</div>
                )) : <div className="text-gray-600 italic">Waiting for agent to start logging...</div>}
                <div ref={consoleEndRef} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {showExportModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Export to GitHub</h3>
              <button onClick={() => setShowExportModal(false)} className="text-gray-500 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <form onSubmit={handleExportGithub} className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-400">GitHub Personal Access Token</label>
                <input type="password" value={githubToken} onChange={(e) => setGithubToken(e.target.value)} placeholder="ghp_xxxxxxxxxxxx" className="w-full px-4 py-2.5 bg-black border border-gray-800 rounded-lg text-white focus:outline-none focus:border-amber-500 transition-colors" required />
                <p className="text-[10px] text-gray-500">Required scopes: <code className="text-amber-400/80">repo</code>. <a href="https://github.com/settings/tokens" target="_blank" className="text-amber-500 hover:underline ml-1">Create one here</a></p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-400">Repository Name</label>
                <input type="text" value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="my-awesome-project" className="w-full px-4 py-2.5 bg-black border border-gray-800 rounded-lg text-white focus:outline-none focus:border-amber-500 transition-colors" required />
              </div>
              {exportError && <div className="p-3 bg-red-900/20 border border-red-800 rounded-lg text-red-400 text-sm">{exportError}</div>}
              {exportUrl && <div className="p-4 bg-green-900/20 border border-green-800 rounded-lg space-y-2"><p className="text-green-400 text-sm font-medium">✨ Export Successful!</p><a href={exportUrl} target="_blank" className="flex items-center gap-2 text-amber-400 hover:text-amber-300 text-xs font-mono break-all">{exportUrl}</a></div>}
              <div className="pt-2 flex gap-3">
                <button type="button" disabled={isExporting} onClick={() => setShowExportModal(false)} className="flex-1 px-4 py-2.5 border border-gray-800 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg font-medium transition-all">Cancel</button>
                <button type="submit" disabled={isExporting || !githubToken || !repoName} className="flex-[2] px-4 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-amber-600/50 text-white rounded-lg font-semibold transition-all flex items-center justify-center gap-2">{isExporting ? <><div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" /> Exporting...</> : <><svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>Push to GitHub</>}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

export default function GeneratePage({ params }: { params: { projectId: string } }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black text-white flex items-center justify-center">Loading...</div>}>
      <GenerateContent projectId={params.projectId} />
    </Suspense>
  );
}
