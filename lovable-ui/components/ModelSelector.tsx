"use client";

import { useState, useEffect, useRef } from "react";

interface Model {
  id: string;
  name: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
    request: string;
  };
}

interface ModelSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

export default function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await fetch("/api/models");
        if (!response.ok) throw new Error("Failed to fetch models");
        const data = await response.json();
        setModels(data.models);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchModels();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredModels = models.filter((model) =>
    model.name.toLowerCase().includes(search.toLowerCase()) ||
    model.id.toLowerCase().includes(search.toLowerCase())
  );

  const selectedModel = models.find((m) => m.id === value) || { name: value, id: value };

  const formatPrice = (pricePerMillion: string) => {
    const p = parseFloat(pricePerMillion);
    if (p === 0) return "Free";
    return `$${(p * 1000000).toFixed(2)}/M tokens`;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded-lg p-2.5 flex items-center justify-between hover:border-gray-600 transition-colors"
        disabled={loading}
      >
        <span className="truncate">
          {loading ? "Loading models..." : (selectedModel.name || selectedModel.id)}
        </span>
        <svg
          className={`w-4 h-4 ml-2 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl overflow-hidden max-h-80 flex flex-col">
          <div className="p-2 border-b border-gray-800">
            <input
              type="text"
              placeholder="Search models..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-black border border-gray-700 text-white text-xs rounded p-2 focus:outline-none focus:border-blue-500"
              autoFocus
            />
          </div>
          <div className="overflow-y-auto flex-1 custom-scrollbar">
            {filteredModels.length > 0 ? (
              filteredModels.map((model) => (
                <button
                  key={model.id}
                  onClick={() => {
                    onChange(model.id);
                    setIsOpen(false);
                    setSearch("");
                  }}
                  className={`w-full text-left px-4 py-2 hover:bg-gray-800 transition-colors border-b border-gray-800 last:border-0 ${
                    value === model.id ? "bg-blue-600/10" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs font-medium ${value === model.id ? "text-blue-400" : "text-gray-200"}`}>
                      {model.name}
                    </span>
                    {model.context_length && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-gray-800 text-gray-500 font-mono">
                        {Math.round(model.context_length / 1024)}K
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-[10px] text-gray-500 truncate max-w-[150px]">{model.id}</p>
                    {model.pricing && (
                      <p className="text-[9px] text-gray-600">
                        {formatPrice(model.pricing.prompt)}
                      </p>
                    )}
                  </div>
                </button>
              ))
            ) : (
              <div className="p-4 text-center text-xs text-gray-500 italic">
                No models found
              </div>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #374151;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #4b5563;
        }
      `}</style>
    </div>
  );
}
