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
      creative_matrix: {
        Row: {
          compliance_approved: boolean
          compliance_notes: string | null
          created_at: string
          format_id: string | null
          hooks_matrix: Json
          id: string
          metadata: Json
          persona_id: string | null
          project_id: string
          source_task_id: string | null
          storyboard: Json
        }
        Insert: {
          compliance_approved?: boolean
          compliance_notes?: string | null
          created_at?: string
          format_id?: string | null
          hooks_matrix: Json
          id?: string
          metadata: Json
          persona_id?: string | null
          project_id: string
          source_task_id?: string | null
          storyboard: Json
        }
        Update: {
          compliance_approved?: boolean
          compliance_notes?: string | null
          created_at?: string
          format_id?: string | null
          hooks_matrix?: Json
          id?: string
          metadata?: Json
          persona_id?: string | null
          project_id?: string
          source_task_id?: string | null
          storyboard?: Json
        }
        Relationships: [
          {
            foreignKeyName: "creative_matrix_format_id_fkey"
            columns: ["format_id"]
            isOneToOne: false
            referencedRelation: "formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_matrix_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_matrix_source_task_id_fkey"
            columns: ["source_task_id"]
            isOneToOne: false
            referencedRelation: "task_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      formats: {
        Row: {
          created_at: string
          framework: string
          hook_structure: string
          id: string
          name: string
          pacing_seconds: number[]
          slide_count: number
          slug: string
          template_json: Json
        }
        Insert: {
          created_at?: string
          framework: string
          hook_structure: string
          id?: string
          name: string
          pacing_seconds?: number[]
          slide_count: number
          slug: string
          template_json: Json
        }
        Update: {
          created_at?: string
          framework?: string
          hook_structure?: string
          id?: string
          name?: string
          pacing_seconds?: number[]
          slide_count?: number
          slug?: string
          template_json?: Json
        }
        Relationships: []
      }
      hook_performance: {
        Row: {
          caption: string | null
          conversions: number
          creative_matrix_id: string | null
          cta_failure: boolean | null
          hook_failure: boolean | null
          id: string
          impressions: number
          measured_at: string
          platform_urls: Json | null
          reach: number
          request_id: string | null
          views_3s: number
        }
        Insert: {
          caption?: string | null
          conversions?: number
          creative_matrix_id?: string | null
          cta_failure?: boolean | null
          hook_failure?: boolean | null
          id?: string
          impressions?: number
          measured_at?: string
          platform_urls?: Json | null
          reach?: number
          request_id?: string | null
          views_3s?: number
        }
        Update: {
          caption?: string | null
          conversions?: number
          creative_matrix_id?: string | null
          cta_failure?: boolean | null
          hook_failure?: boolean | null
          id?: string
          impressions?: number
          measured_at?: string
          platform_urls?: Json | null
          reach?: number
          request_id?: string | null
          views_3s?: number
        }
        Relationships: [
          {
            foreignKeyName: "hook_performance_creative_matrix_id_fkey"
            columns: ["creative_matrix_id"]
            isOneToOne: false
            referencedRelation: "creative_matrix"
            referencedColumns: ["id"]
          },
        ]
      }
      personas: {
        Row: {
          created_at: string
          demographic: string | null
          display_name: string
          do_not_say: string[]
          emotional_range: string[]
          id: string
          slug: string
          speech_quirks: Json
          voice_profile: string
        }
        Insert: {
          created_at?: string
          demographic?: string | null
          display_name: string
          do_not_say?: string[]
          emotional_range?: string[]
          id?: string
          slug: string
          speech_quirks?: Json
          voice_profile: string
        }
        Update: {
          created_at?: string
          demographic?: string | null
          display_name?: string
          do_not_say?: string[]
          emotional_range?: string[]
          id?: string
          slug?: string
          speech_quirks?: Json
          voice_profile?: string
        }
        Relationships: []
      }
      scene_library: {
        Row: {
          category: string
          consistency_locks: Json
          created_at: string
          forbidden_elements: string[]
          id: string
          preservation_rules: string[]
          scene_key: string
          visual_prompt: string
        }
        Insert: {
          category: string
          consistency_locks: Json
          created_at?: string
          forbidden_elements?: string[]
          id?: string
          preservation_rules?: string[]
          scene_key: string
          visual_prompt: string
        }
        Update: {
          category?: string
          consistency_locks?: Json
          created_at?: string
          forbidden_elements?: string[]
          id?: string
          preservation_rules?: string[]
          scene_key?: string
          visual_prompt?: string
        }
        Relationships: []
      }
      task_queue: {
        Row: {
          agent: Database["public"]["Enums"]["task_agent"]
          created_at: string
          error: string | null
          id: string
          parent_task_id: string | null
          payload: Json
          project_id: string
          result: Json | null
          status: Database["public"]["Enums"]["task_status"]
          updated_at: string
        }
        Insert: {
          agent: Database["public"]["Enums"]["task_agent"]
          created_at?: string
          error?: string | null
          id?: string
          parent_task_id?: string | null
          payload: Json
          project_id: string
          result?: Json | null
          status?: Database["public"]["Enums"]["task_status"]
          updated_at?: string
        }
        Update: {
          agent?: Database["public"]["Enums"]["task_agent"]
          created_at?: string
          error?: string | null
          id?: string
          parent_task_id?: string | null
          payload?: Json
          project_id?: string
          result?: Json | null
          status?: Database["public"]["Enums"]["task_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_queue_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "task_queue"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      task_agent:
        | "a0"
        | "a1"
        | "a2"
        | "a3"
        | "a4"
        | "a5"
        | "a6"
        | "qc"
        | "a7"
        | "a8"
        | "ceo"
      task_status: "pending" | "in_progress" | "awaiting_qc" | "done" | "failed"
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
      task_agent: [
        "a0",
        "a1",
        "a2",
        "a3",
        "a4",
        "a5",
        "a6",
        "qc",
        "a7",
        "a8",
        "ceo",
      ],
      task_status: ["pending", "in_progress", "awaiting_qc", "done", "failed"],
    },
  },
} as const
