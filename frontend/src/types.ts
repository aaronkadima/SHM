export type Availability =
  | "ready"
  | "requires_weights"
  | "missing_dependency"
  | "disabled";

export interface EngineInfo {
  id: string;
  name: string;
  family: string;
  task: string;
  backend: string;
  adapter: string;
  description: string;
  strengths: string;
  availability: Availability;
  status_reason?: string | null;
  requires_weights: boolean;
  pathology_ready: boolean;
  open_vocabulary: boolean;
}

export interface Detection {
  label: string;
  raw_label?: string | null;
  confidence: number;
  bbox?: number[] | null;
  polygon?: number[][] | null;
  area_px?: number | null;
}

export interface EngineResult {
  engine_id: string;
  state: "ok" | "skipped" | "error";
  elapsed_ms: number;
  detections: Detection[];
  affected_area_percent?: number | null;
  overlay_base64?: string | null;
  note?: string | null;
  error?: string | null;
}

export interface AnalysisResponse {
  filename: string;
  width: number;
  height: number;
  engines_requested: string[];
  results: EngineResult[];
  warnings: string[];
}
