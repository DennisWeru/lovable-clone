"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import { createClient } from "@/lib/supabase/client";

interface Message {
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

import { Suspense } from "react";

function GenerateContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const prompt = searchParams.get("prompt") || "";
  const model = searchParams.get("model") || "gemini-2.5-flash";
  const initialSandboxId = searchParams.get("sandboxId");
  const initialPreviewUrl = searchParams.get("previewUrl");
  const projectId = searchParams.get("projectId");
  
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
  
  useEffect(() => {
    if (!prompt && !initialSandboxId) {
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
              setMessages(
                historyMsgs.map((m: any) => ({
                  type: m.type,
                  content: m.content ?? undefined,
                  name: m.metadata?.name,
                  input: m.metadata?.input,
                  isHistory: true,
                }))
              );
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
      
      // Start stall detection timer (3 minutes) - generation can take a while with retries
      if (loadingStuckTimerRef.current) clearTimeout(loadingStuckTimerRef.current);
      loadingStuckTimerRef.current = setTimeout(() => {
        setIsGenerating(false);
        setError({
          message: "The generation worker did not report completion in time. This might be due to a slow AI response or large dependency install.",
          code: "WORKER_STALLED"
        });
        setShowLogsAction(true);
      }, 180000);

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
            const message: Message = {
              type: newMessage.type,
              content: newMessage.content ?? undefined,
              message: newMessage.content ?? undefined,
              name: newMessage.metadata?.name,
              input: newMessage.metadata?.input,
              previewUrl: newMessage.metadata?.previewUrl,
              sandboxId: newMessage.metadata?.sandboxId,
            };

            
            // Clear stall timer if we get any message
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
            if (loadingStuckTimerRef.current) clearTimeout(loadingStuckTimerRef.current);
            setError({ message: "Realtime connection failed. Updates may not appear automatically." });
            setIsGenerating(false);
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
    
    // Add user message to UI (optional, since Lovable will reply)
    // Actually, Lovable replies with progress messages
    
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

  const getFriendlyError = (error: { message: string; code?: string }) => {
    // If sandbox not found, clear it so next retry creates a new one
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
          description: "There was an issue spinning up your environment. This might be a temporary Daytona outage.",
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
  
  const formatToolInput = (input: any) => {
    if (!input) return "";
    
    // Extract key information based on tool type
    if (input.file_path) {
      return `File: ${input.file_path}`;
    } else if (input.command) {
      return `Command: ${input.command}`;
    } else if (input.pattern) {
      return `Pattern: ${input.pattern}`;
    } else if (input.prompt) {
      return `Prompt: ${input.prompt.substring(0, 100)}...`;
    }
    
    // For other cases, show first meaningful field
    const keys = Object.keys(input);
    if (keys.length > 0) {
      const firstKey = keys[0];
      const value = input[firstKey];
      if (typeof value === 'string' && value.length > 100) {
        return `${firstKey}: ${value.substring(0, 100)}...`;
      }
      return `${firstKey}: ${value}`;
    }
    
    return JSON.stringify(input).substring(0, 100) + "...";
  };

  return (
    <main className="h-screen bg-black flex flex-col overflow-hidden relative">
      <Navbar />
      {/* Spacer for navbar */}
      <div className="h-16" />
      
      <div className="flex-1 flex overflow-hidden">
        {/* Left side - Chat */}
        <div className="w-[30%] flex flex-col border-r border-gray-800">
          {/* Header */}
          <div className="p-4 border-b border-gray-800 flex items-center justify-between">
            <div>
              <h2 className="text-white font-semibold flex items-center gap-2">
                Lovable
                {isGenerating && (
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                )}
              </h2>
              <p className="text-gray-400 text-xs mt-1 truncate max-w-[200px]">{prompt}</p>
            </div>
            <button 
              onClick={() => setShowConsole(!showConsole)}
              className={`p-1.5 rounded-md border transition-colors ${showConsole ? 'bg-blue-600/20 border-blue-500/50 text-blue-400' : 'border-gray-800 text-gray-400 hover:text-gray-300'}`}
              title="Toggle Agent Console"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
          
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 overflow-x-hidden">
            {isLoadingHistory && (
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-500" />
                Loading conversation history...
              </div>
            )}

            {messages.map((message, index) => (
              <div key={index}>
                {/* History divider — shown before first non-history message */}
                {!message.isHistory && index > 0 && messages[index - 1].isHistory && (
                  <div className="flex items-center gap-2 py-2">
                    <div className="flex-1 h-px bg-gray-800" />
                    <span className="text-xs text-gray-600 px-2">New session</span>
                    <div className="flex-1 h-px bg-gray-800" />
                  </div>
                )}

                {message.type === "user" && (
                  <div className="flex justify-end">
                    <div className="bg-blue-600/20 border border-blue-500/30 rounded-lg p-3 max-w-[85%]">
                      <p className="text-blue-100 text-sm whitespace-pre-wrap break-words">{message.content}</p>
                    </div>
                  </div>
                )}

                {message.type === "claude_message" && (
                  <div className="bg-gray-900 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 bg-purple-600 rounded-full flex items-center justify-center">
                        <span className="text-white text-xs">L</span>
                      </div>
                      <span className="text-white font-medium">Lovable</span>
                      {message.isHistory && (
                        <span className="text-xs text-gray-600 ml-auto">history</span>
                      )}
                    </div>
                    <p className="text-gray-300 whitespace-pre-wrap break-words">{message.content}</p>
                  </div>
                )}
                
                {message.type === "tool_use" && (
                  <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-800 overflow-hidden">
                    <div className="flex items-start gap-2 text-sm">
                      <span className="text-blue-400 flex-shrink-0">🔧 {message.name}</span>
                      <span className="text-gray-500 break-all">{formatToolInput(message.input)}</span>
                    </div>
                  </div>
                )}
                
                {message.type === "progress" && (
                  <div className="text-gray-500 text-sm font-mono break-all">
                    {message.content || message.message}
                  </div>
                )}
              </div>
            ))}
            
            {isGenerating && (
              <div className="flex items-center gap-2 text-gray-400">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
                <span>Working...</span>
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
                    <button
                      onClick={() => generateWebsite(lastPrompt)}
                      className="px-3 py-1.5 bg-red-600/30 hover:bg-red-600/40 text-red-200 text-xs rounded-md border border-red-500/30 transition-colors"
                    >
                      ↺ Retry
                    </button>
                  )}
                  {getFriendlyError(error).canRestart && (
                    <button
                      onClick={handleRestartServer}
                      className="px-3 py-1.5 bg-blue-600/30 hover:bg-blue-600/40 text-blue-200 text-xs rounded-md border border-blue-500/30 transition-colors"
                    >
                      ⚡ Restart Server
                    </button>
                  )}
                  {showLogsAction && (
                    <button
                      onClick={fetchWorkerLogs}
                      className="px-3 py-1.5 bg-yellow-600/30 hover:bg-yellow-600/40 text-yellow-200 text-xs rounded-md border border-yellow-500/30 transition-colors"
                    >
                      📄 Fetch Worker Logs
                    </button>
                  )}
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
          
          {/* Bottom input area */}
          <div className="p-4 border-t border-gray-800">
            <form onSubmit={handleSubmit} className="flex items-center gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Ask Lovable..."
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
        
        {/* Right side - Preview */}
        <div className="w-[70%] bg-gray-950 flex flex-col relative">
          {/* Preview Toolbar */}
          {previewUrl && (
            <div className="h-12 bg-gray-900/50 border-b border-gray-800 flex items-center justify-between px-4 z-10 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">Live Preview</span>
              </div>
              <div className="flex items-center gap-3">
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-all flex items-center gap-1.5 text-xs border border-transparent hover:border-gray-700"
                  title="Open in new tab"
                >
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
              <iframe
                key={`preview-${regenCount}`}
                src={previewUrl}
                className="w-full h-full bg-white" 
                title="Website Preview"
              />
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

          {/* Agent Console Drawer */}
          <div className={`absolute bottom-0 left-0 right-0 bg-black/90 border-t border-gray-800 transition-all duration-300 ease-in-out z-20 ${showConsole ? 'h-[250px]' : 'h-0 overflow-hidden border-transparent'}`}>
            <div className="h-full flex flex-col">
              <div className="px-4 py-2 bg-gray-950 border-b border-gray-800 flex items-center justify-between sticky top-0">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  <span className="text-xs font-mono text-blue-400 font-bold uppercase tracking-wider">Agent Console Logs</span>
                </div>
                <button onClick={() => setShowConsole(false)} className="text-gray-500 hover:text-white transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] text-gray-300 space-y-1">
                {logs ? (
                  logs.split('\n').map((line, i) => (
                    <div key={i} className={`break-words ${line.includes('[Worker]') ? 'text-blue-300' : line.includes('[Tool]') ? 'text-purple-400' : line.includes('error') || line.includes('Fatal') ? 'text-red-400' : 'text-gray-400'}`}>
                      {line}
                    </div>
                  ))
                ) : (
                  <div className="text-gray-600 italic">Waiting for agent to start logging...</div>
                )}
                <div ref={consoleEndRef} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function GeneratePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black text-white flex items-center justify-center">Loading...</div>}>
      <GenerateContent />
    </Suspense>
  );
}