export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      claim_metadata: {
        Row: {
          domain_tags: Json | null
          embedding: string | null
          node_id: string
        }
        Insert: {
          domain_tags?: Json | null
          embedding?: string | null
          node_id: string
        }
        Update: {
          domain_tags?: Json | null
          embedding?: string | null
          node_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_metadata_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: true
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      edges: {
        Row: {
          child_id: string
          created_at: string
          id: string
          log_lr_negative: number
          log_lr_positive: number
          parent_id: string
          perspective_id: string
          reasoning: string | null
          relevance_weight: number
        }
        Insert: {
          child_id: string
          created_at?: string
          id?: string
          log_lr_negative: number
          log_lr_positive: number
          parent_id: string
          perspective_id: string
          reasoning?: string | null
          relevance_weight: number
        }
        Update: {
          child_id?: string
          created_at?: string
          id?: string
          log_lr_negative?: number
          log_lr_positive?: number
          parent_id?: string
          perspective_id?: string
          reasoning?: string | null
          relevance_weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "edges_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edges_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edges_perspective_id_fkey"
            columns: ["perspective_id"]
            isOneToOne: false
            referencedRelation: "perspectives"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_metadata: {
        Row: {
          authors: Json | null
          content_summary: string | null
          journal_or_publisher: string | null
          methodology_notes: Json | null
          node_id: string
          provenance_tier: number | null
          publication_date: string | null
          source_type:
            | Database["public"]["Enums"]["evidence_source_type"]
            | null
          source_url: string | null
        }
        Insert: {
          authors?: Json | null
          content_summary?: string | null
          journal_or_publisher?: string | null
          methodology_notes?: Json | null
          node_id: string
          provenance_tier?: number | null
          publication_date?: string | null
          source_type?:
            | Database["public"]["Enums"]["evidence_source_type"]
            | null
          source_url?: string | null
        }
        Update: {
          authors?: Json | null
          content_summary?: string | null
          journal_or_publisher?: string | null
          methodology_notes?: Json | null
          node_id?: string
          provenance_tier?: number | null
          publication_date?: string | null
          source_type?:
            | Database["public"]["Enums"]["evidence_source_type"]
            | null
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evidence_metadata_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: true
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      nodes: {
        Row: {
          convergence_status: Database["public"]["Enums"]["convergence_status"]
          created_at: string
          evidence_weight: number
          id: string
          log_odds_posterior: number
          log_odds_prior: number
          perspective_id: string
          source: Database["public"]["Enums"]["node_source"]
          text: string
          type: Database["public"]["Enums"]["node_type"]
          updated_at: string
        }
        Insert: {
          convergence_status?: Database["public"]["Enums"]["convergence_status"]
          created_at?: string
          evidence_weight?: number
          id?: string
          log_odds_posterior?: number
          log_odds_prior?: number
          perspective_id: string
          source: Database["public"]["Enums"]["node_source"]
          text: string
          type: Database["public"]["Enums"]["node_type"]
          updated_at?: string
        }
        Update: {
          convergence_status?: Database["public"]["Enums"]["convergence_status"]
          created_at?: string
          evidence_weight?: number
          id?: string
          log_odds_posterior?: number
          log_odds_prior?: number
          perspective_id?: string
          source?: Database["public"]["Enums"]["node_source"]
          text?: string
          type?: Database["public"]["Enums"]["node_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nodes_perspective_id_fkey"
            columns: ["perspective_id"]
            isOneToOne: false
            referencedRelation: "perspectives"
            referencedColumns: ["id"]
          },
        ]
      }
      perspectives: {
        Row: {
          created_at: string
          id: string
          name: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      update_log: {
        Row: {
          created_at: string
          evidence_weight_after: number
          evidence_weight_before: number
          id: string
          log_odds_after: number
          log_odds_before: number
          node_id: string
          reasoning: string | null
          source: Database["public"]["Enums"]["update_source"]
          trigger_edge_id: string | null
        }
        Insert: {
          created_at?: string
          evidence_weight_after: number
          evidence_weight_before: number
          id?: string
          log_odds_after: number
          log_odds_before: number
          node_id: string
          reasoning?: string | null
          source: Database["public"]["Enums"]["update_source"]
          trigger_edge_id?: string | null
        }
        Update: {
          created_at?: string
          evidence_weight_after?: number
          evidence_weight_before?: number
          id?: string
          log_odds_after?: number
          log_odds_before?: number
          node_id?: string
          reasoning?: string | null
          source?: Database["public"]["Enums"]["update_source"]
          trigger_edge_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "update_log_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "update_log_trigger_edge_id_fkey"
            columns: ["trigger_edge_id"]
            isOneToOne: false
            referencedRelation: "edges"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      search_claims_by_embedding: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          convergence_status: Database["public"]["Enums"]["convergence_status"]
          evidence_weight: number
          log_odds_posterior: number
          node_id: string
          similarity: number
          text: string
        }[]
      }
    }
    Enums: {
      convergence_status: "INITIAL" | "STABLE" | "UNSTABLE"
      evidence_source_type:
        | "JOURNAL_ARTICLE"
        | "PREPRINT"
        | "SURVEY"
        | "NEWS_ARTICLE"
        | "REPORT"
        | "BOOK"
        | "OTHER"
      node_source: "USER" | "LLM_DECOMPOSITION" | "LLM_EVIDENCE_SEARCH"
      node_type: "CLAIM" | "EVIDENCE"
      update_source:
        | "LLM_DECOMPOSITION"
        | "LLM_EVIDENCE_EVAL"
        | "USER_MANUAL"
        | "PROPAGATION"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      convergence_status: ["INITIAL", "STABLE", "UNSTABLE"],
      evidence_source_type: [
        "JOURNAL_ARTICLE",
        "PREPRINT",
        "SURVEY",
        "NEWS_ARTICLE",
        "REPORT",
        "BOOK",
        "OTHER",
      ],
      node_source: ["USER", "LLM_DECOMPOSITION", "LLM_EVIDENCE_SEARCH"],
      node_type: ["CLAIM", "EVIDENCE"],
      update_source: [
        "LLM_DECOMPOSITION",
        "LLM_EVIDENCE_EVAL",
        "USER_MANUAL",
        "PROPAGATION",
      ],
    },
  },
} as const
