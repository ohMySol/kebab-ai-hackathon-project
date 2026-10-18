// Shared shapes for Gauge (see contracts/http.md). Scores: 0 = lowest risk, 100 = highest. null = unknown.
export type Profile = 'quality_first' | 'balanced' | 'financial_first';
export interface Selection { component: string; profile: Profile; max_risk: number; query: string; exclude: string[]; candidate_ids: string[]; limit: number; }
export interface Operations { po_volume_eur?: number | null; order_change_rate?: number | null; delivery_rating?: number | null; confirmation_rate?: number | null; sourcing_risk_level?: string | null; supply_chain_complexity?: string | null; }
export interface Supplier { id: string; name: string; tri: number | null; level: string; scores: Record<string, number | null>; source_levels: Record<string, string>; operations: Operations; }
export interface Ranked extends Supplier { buyer_score: number; contributions: Record<string, number>; rank: number; }
export interface Shortlist { suppliers: Ranked[]; total: number; scoped: number; matched: number; unrankable: number; risk_filtered: number; missing_candidate_ids: string[]; excluded: {id: string; name: string}[]; weights: Record<string, number>; version: string; request: Selection; capability: string; }
export interface Provider { configured: boolean; ok: boolean | null; tested_at: number | null; detail: string; }
export interface Status { rows: number; name: string; sample: boolean; version: string; model: string; nemotron: boolean; tavily: boolean; providers: {nemotron: Provider; tavily: Provider}; reports: number; }
export interface Trace { tool: string; status: 'done' | 'error'; detail: string; }
export interface ChatReply { reply: string; selection: Shortlist; comparison: {suppliers: Supplier[]} | null; job_id: string | null; trace: Trace[]; live: true; model: string; }
export interface Source { id: number; title: string; url: string; content: string; published?: string | null; }
export interface ResearchJob { id: string; company: string; context: string; status: 'queued' | 'running' | 'done' | 'error'; steps: {text: string; state: 'running' | 'done' | 'error'; at: number}[]; sources: Source[]; follow_up_reason?: string; report?: string; citation_warning?: boolean; error?: string; elapsed?: number; created: number; }
