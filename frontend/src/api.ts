import type { AnalysisResponse, EngineInfo } from "./types";

const API = import.meta.env.VITE_API_URL ?? "/api";

export async function fetchEngines(): Promise<EngineInfo[]> {
  const response = await fetch(`${API}/engines`);
  if (!response.ok) throw new Error(`Falha ao carregar motores (${response.status}).`);
  return response.json();
}

export async function analyzeImage(
  file: File,
  engineIds: string[],
  confidence: number,
): Promise<AnalysisResponse> {
  const form = new FormData();
  form.append("file", file);
  form.append("engine_ids", JSON.stringify(engineIds));
  form.append("confidence", String(confidence));

  const response = await fetch(`${API}/analyze`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail ?? `Falha na análise (${response.status}).`);
  }
  return response.json();
}
