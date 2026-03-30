import { NextResponse } from "next/server";

export async function GET() {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    const data = await response.json();
    
    // Sort models: prioritize certain vendors or alphabetically
    const models = data.data.map((model: any) => ({
      id: model.id,
      name: model.name,
      description: model.description,
      pricing: model.pricing,
      context_length: model.context_length,
    })).sort((a: any, b: any) => a.name.localeCompare(b.name));

    return NextResponse.json({ models });
  } catch (error: any) {
    console.error("Failed to fetch OpenRouter models:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
